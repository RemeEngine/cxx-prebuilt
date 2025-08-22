import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { $, copyDir, copyFileToDir, envVar, gn, python } from './utils.ts';

/**
 * Builds Google ANGLE for the specified platform.
 * @param enableAsan Whether to enable AddressSanitizer (if supported)
 * @param outDir Output directory for built artifacts
 */
export function build_angle(enableAsan: boolean, outDir: string) {
	const targetOS = envVar('TARGET_OS');
	const targetArch = envVar('TARGET_ARCH');

	let gnArgs: string[] = [
		'is_debug=false',
		'is_clang=true',
		'is_component_build=false', // Static linking recommended for distribution
		'treat_warnings_as_errors=false',
		'clang_use_chrome_plugins=false',

		// Minimize size of debuginfo
		'symbol_level=1',
		'use_debug_fission=false',

		// ANGLE specific settings
		'angle_enable_d3d9=false',
		'angle_enable_d3d11=false',
		'angle_enable_vulkan=false',
		'angle_enable_gl=false',
		'angle_enable_metal=false',
		'angle_enable_null=false',
		'angle_enable_swiftshader=false',
	];

	if (enableAsan) {
		gnArgs.push('is_asan=true');
	}

	// Platform-specific configuration
	if (targetOS === 'windows') {
		gnArgs.push('target_os=win', 'angle_angle_enable_vulkanenable_d3d11=true ');
	} else if (targetOS === 'macos') {
		gnArgs.push('target_os=mac', 'angle_enable_metal=true');
	} else if (targetOS === 'ios') {
		gnArgs.push('target_os=ios', 'angle_enable_metal=true');
	} else if (targetOS === 'linux') {
		gnArgs.push('target_os=linux', 'angle_enable_vulkan=true', 'angle_enable_gl=true');
	} else if (targetOS === 'android') {
		throw new Error('Android builds are not supported (Android support OpenGLES natively)');
	}

	// Architecture-specific configuration
	if (targetArch === 'aarch64') {
		gnArgs.push('target_cpu=arm64');
	} else if (targetArch === 'arm') {
		gnArgs.push('target_cpu=arm');
	} else if (targetArch === 'i686') {
		gnArgs.push('target_cpu=x86');
	} else if (targetArch === 'x86_64') {
		gnArgs.push('target_cpu=x64');
	}

	const gnOutDir = 'gn_out';
	const args = gnArgs.join(' ');

	// Generate build files with gn
	$(gn(), [`--script-executable=${python()}`, 'gen', gnOutDir, '--ide=json', `--args="${args}"`]);

	// Build ANGLE libraries
	$('ninja', ['-C', gnOutDir, 'libEGL', 'libGLESv2']);

	// Copy built artifacts to output directory
	copyAngleArtifacts(gnOutDir, outDir, targetOS, targetArch);
}

/**
 * Copy ANGLE build artifacts to the output directory
 */
function copyAngleArtifacts(buildDir: string, outDir: string, targetOS: string, targetArch: string) {
	const libArchDir = path.join(outDir, 'lib', `${targetArch}-${targetOS}`);
	const binArchDir = path.join(outDir, 'bin', `${targetArch}-${targetOS}`);
	const includeDir = path.join(outDir, 'include');

	if (targetOS === 'windows') {
		// Windows: Copy DLLs and import libraries
		copyFileToDir(path.join(buildDir, 'libEGL.dll'), binArchDir);
		copyFileToDir(path.join(buildDir, 'libGLESv2.dll'), binArchDir);
		copyFileToDir(path.join(buildDir, 'libEGL.dll.lib'), libArchDir);
		copyFileToDir(path.join(buildDir, 'libGLESv2.dll.lib'), libArchDir);

		// Also copy static libraries if they exist
		copyFileToDir(path.join(buildDir, 'obj', 'libEGL.lib'), libArchDir);
		copyFileToDir(path.join(buildDir, 'obj', 'libGLESv2.lib'), libArchDir);
	} else if (targetOS === 'macos' || targetOS === 'ios') {
		// macOS/iOS: Copy dylib files and static libraries
		copyFileToDir(path.join(buildDir, 'libEGL.dylib'), libArchDir);
		copyFileToDir(path.join(buildDir, 'libGLESv2.dylib'), libArchDir);
		copyFileToDir(path.join(buildDir, 'obj', 'libEGL.a'), libArchDir);
		copyFileToDir(path.join(buildDir, 'obj', 'libGLESv2.a'), libArchDir);
	} else {
		// Linux/Android: Copy shared and static libraries
		copyFileToDir(path.join(buildDir, 'libEGL.so'), libArchDir);
		copyFileToDir(path.join(buildDir, 'libGLESv2.so'), libArchDir);
		copyFileToDir(path.join(buildDir, 'obj', 'libEGL.a'), libArchDir);
		copyFileToDir(path.join(buildDir, 'obj', 'libGLESv2.a'), libArchDir);
	}

	// Copy header files (standard Khronos headers)
	const includeSourceDir = path.join('include');
	if (fs.existsSync(includeSourceDir)) {
		copyDir(includeSourceDir, includeDir, { ext: ['.h'] });
	}
}
