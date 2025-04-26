import path from 'node:path';
import fs from 'node:fs';

import {
	$,
	boolean,
	copyFileToDir,
	copyGlob,
	envVar,
	gn,
	maybeCloneRepo,
	python,
} from './utils.ts';

export function build_v8(isAsan: boolean, installDir: string) {
	const targetOS = envVar('TARGET_OS');
	const targetArch = envVar('TARGET_ARCH');
	const v8EnablePointerCompression = boolean(
		envVar('V8_ENABLE_POINTER_COMPRESSION')
	);

	const gnArgs = [
		'is_debug=false',
		'is_clang=true',

		'v8_monolithic=true',
		`v8_enable_pointer_compression=${v8EnablePointerCompression}`,
		'treat_warnings_as_errors=false',
		// `cc_wrapper="${which('sccache')}"`,

		'clang_use_chrome_plugins=false',
		'is_component_build=false',

		// Minimize size of debuginfo in distributed static library.
		'symbol_level=1',
		'use_debug_fission=false',

		'v8_enable_sandbox=false',
		'v8_enable_javascript_promise_hooks=false',
		'v8_promise_internal_field_count=1',
		'v8_use_external_startup_data=false',

		// We can do snapshot compression ourselves.
		'v8_use_zlib=false',
		'v8_enable_snapshot_compression=false',

		// Disable handle zapping for performance
		'v8_enable_handle_zapping=false',
		// Ensure allocation of typed arrays and arraybuffers always goes through
		// the embedder's ArrayBufferAllocator, otherwise small buffers get moved
		// around by the garbage collector but embedders normally want them to have
		// fixed addresses.
		'v8_typed_array_max_size_in_heap=0',

		// Historically these always had 2 slots. Keep for compat.
		'v8_array_buffer_internal_field_count=2',
		'v8_array_buffer_view_internal_field_count=2',

		// V8 11.6 hardcoded an assumption in `mksnapshot` that shared RO heap
		// is enabled. In our case it's disabled so without this flag we can't
		// compile.
		'v8_enable_verify_heap=false',

		// Enable V8 object print for debugging.
		// 'v8_enable_object_print=true',

		// V8 12.3 added google/fuzztest as a third party dependency.
		// https://chromium.googlesource.com/v8/v8.git/+/d5acece0c9b89b18716c177d1fcc8f734191e1e2%5E%21/#F4
		//
		// This flag disables it.
		'v8_enable_fuzztest=false',

		// Don't depend on ICU data file.
		'v8_depend_on_icu_data_file=false',
		'icu_copy_icudata_to_root_build_dir=false',
	];

	if (targetOS !== 'windows') {
		gnArgs.push('simple_template_names=true');
	}

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
	$(
		gn(),
		[
			`--script-executable=${python()}`,
			'gen',
			'gn_out',
			'--ide=json',
			`--args="${args}"`,
		]
	);

	$(gn(), [`--script-executable=${python()}`, 'args', 'gn_out', '--list']);

	$('ninja', ['-C', 'gn_out', 'v8_monolith']);

	const libArchDir = path.join(installDir, 'lib', `${targetArch}-${targetOS}`);
	copyFileToDir('./gn_out/obj/v8_monolith.lib', libArchDir);
	copyFileToDir('./gn_out/obj/libv8_monolith.a', libArchDir);
	copyGlob('./include/**/*.h', path.join(installDir, 'include'));
	copyGlob('./include/**/*.md', path.join(installDir, 'include'));
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
