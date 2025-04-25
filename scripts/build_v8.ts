import path from 'node:path';
import fs from 'node:fs';

import {
	$,
	envVar,
	findSystemClang,
	gn,
	maybeCloneRepo,
	python,
	setEnvVar,
} from './utils.ts';

export function build_v8(isAsan: boolean) {
	setEnvVar('DEPOT_TOOLS_WIN_TOOLCHAIN', '0');

	const targetOS = envVar('TARGET_OS');
	const targetArch = envVar('TARGET_ARCH');
	const v8EnablePointerCompression =
		envVar('V8_ENABLE_POINTER_COMPRESSION') === 'true';

	const gnArgs = [
		'is_debug=false',
		'use_custom_libcxx=false',
		`v8_enable_pointer_compression=${v8EnablePointerCompression}`,
		'is_clang=true',
		`clang_base_path=${findSystemClang()}`,
		'treat_warnings_as_errors=false',
		'cc_wrapper=sccache',
	];

	if (isAsan) {
		gnArgs.push('is_asan=true');
	}

	// Fix GN's host_cpu detection when using x86_64 bins on Apple Silicon
	if (targetOS === 'macos' && targetArch === 'aarch64') {
		gnArgs.push('host_cpu="arm64"');
	}

	// cross-compilation setup
	if (targetArch === 'aarch64') {
		gnArgs.push('target_cpu="arm64"');
		gnArgs.push('use_sysroot=true');
		maybeInstallSysroot('arm64');
		maybeInstallSysroot('amd64');
	}

	if (targetArch === 'arm') {
		gnArgs.push('target_cpu="arm"');
		gnArgs.push('v8_target_cpu="arm"');
		gnArgs.push('use_sysroot=true');
		maybeInstallSysroot('i386');
		maybeInstallSysroot('arm');
	}

	if (targetOS === 'android') {
		let arch: string = 'unknown';
		switch (targetArch) {
			case 'x86_64':
				arch = 'x64';
				break;
			case 'aarch64':
				arch = 'arm64';
				break;
		}

		if (targetArch === 'x86_64') {
			maybeInstallSysroot('amd64');
		}

		gnArgs.push(`v8_target_cpu="${arch}"`);
		gnArgs.push(`target_cpu="${arch}"`);
		gnArgs.push('target_os="android"');
		gnArgs.push('use_sysroot=true');

		// NDK 23 and above removes libgcc entirely.
		if (
			!fs.existsSync(
				'./third_party/android_ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang++'
			)
		) {
			$('curl', [
				'-L',
				'-o',
				'./third_party/android-ndk-r26c-linux.zip',
				'https://dl.google.com/android/repository/android-ndk-r26c-linux.zip',
			]);

			$('unzip', [
				'-d',
				'./third_party/',
				'-o',
				'-q',
				'./third_party/android-ndk-r26c-linux.zip',
			]);

			fs.renameSync(
				'./third_party/android-ndk-r26c',
				'./third_party/android_ndk'
			);
			fs.unlinkSync('./third_party/android-ndk-r26c-linux.zip');
		}

		const CHROMIUM_URI = 'https://chromium.googlesource.com';
		maybeCloneRepo(
			'./third_party/android_platform',
			`${CHROMIUM_URI}/chromium/src/third_party/android_platform.git`
		);
		maybeCloneRepo(
			'./third_party/catapult',
			`${CHROMIUM_URI}/catapult.git`
		);
	}

	if (targetArch === 'i686') {
		gnArgs.push('target_cpu="x86"');
	}

	const args = gnArgs.join(' ');
	$(gn(), [
		`--script-executable=${python()}`,
		'gen',
		'gn_out',
		'--ide=json',
		`--args=${args}`,
	]);

	$(gn(), [`--script-executable=${python()}`, 'args', 'gn_out', '--list']);

	$('ninja', ['-C', 'gn_out']);
}

function maybeInstallSysroot(arch: string) {
	const sysrootPath = path.resolve(`build/linux/debian_sid_${arch}-sysroot`);
	if (fs.statSync(sysrootPath, { throwIfNoEntry: false })?.isDirectory()) {
		return;
	}

	$(python(), [
		'./build/linux/sysroot_scripts/install-sysroot.py',
		`--arch=${arch}`,
	]);
}
