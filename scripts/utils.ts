import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

import VERSIONS from '../build-versions.json' with { type: 'json' };

export function setEnvVar(name: string, value: string) {
	process.env[name] = value;
}

export function envVar(name: string): string {
	const value = process.env[name];
	if (typeof value !== 'string') {
		throw new Error(`Environment variable "${name}" not found`);
	}

	return value;
}

const gDirStack: string[] = [];

export function pushDir(dir: string) {
	gDirStack.push(process.cwd());
	process.chdir(dir);
}

export function popDir() {
	if (gDirStack.length === 0) {
		throw new Error('Directory stack is empty');
	}

	process.chdir(gDirStack.pop()!);
}

export function restoreDir() {
	if (gDirStack.length > 0) {
		process.chdir(gDirStack[0]);
	}

	gDirStack.length = 0;
}

export function findSystemClang(): string {
	const clangBasePath = path.resolve(envVar('CLANG_BASE_PATH'));
	const clangPath = path.join(
		clangBasePath,
		'bin',
		'clang' + (process.platform === 'win32' ? '.exe' : '')
	);
	if (!fs.existsSync(clangPath)) {
		throw new Error(`Clang not found at ${clangPath}`);
	}

	return clangBasePath;
}

export function python(): string {
	return 'python3';
}

export function gn(): string {
	return 'gn';
}

export function which(command: string): string {
	const pathEnv = process.env['PATH'] as string;
	const pathExt = process.platform === 'win32' ? ['.exe', '.bat', '.cmd', '.ps1'] : [''];

	for (const envPart of pathEnv.split(path.delimiter)) {
		for (const ext of pathExt) {
			const p = path.join(envPart, command + ext);
			if (fs.existsSync(p)) {
				return p;
			}
		}
	}

	throw new Error(`Command "${command}" not found in PATH`);
}

export function $(command: string, args: string[] = []) {
	console.log(`> ${command} ${args.join(' ')}`);
	const ret = spawnSync(command, args, {
		stdio: ['ignore', 1, 1],
		shell: true,
	});

	if (ret.status !== 0) {
		throw new Error(`Command exited with code ${ret.status}`);
	}

	return ret;
}

export function maybeCloneRepo(dest: string, repo: string) {
	if (fs.existsSync(dest)) {
		return;
	}

	$('git', ['clone', '--depth=1', repo, dest]);
}

export function setupSource(repo: keyof typeof VERSIONS) {
	const info = VERSIONS[repo];

	if (fs.existsSync(repo)) {
		pushDir(repo);
		$('git', ['pull']);
		$('git', ['checkout', info.branch]);
		$('git', ['submodule', 'update', '--init', '--recursive']);
		popDir();
	} else {
		$('git', [
			'clone',
			'--recurse-submodules',
			'--branch',
			info.branch,
			info.git,
			repo,
		]);
	}

	fs.writeFileSync(
		path.join(repo, '.gclient'),
		`solutions = [{
			"name": ".",
			"url": "${info.git}",
			"deps_file": "DEPS",
			"managed": False,
			"custom_deps": {},
		}]`
	);
}

export function maybeSetupDepotTools() {
	if (!fs.existsSync('depot_tools')) {
		$('git', [
			'clone',
			'--depth=1',
			'https://chromium.googlesource.com/chromium/tools/depot_tools.git',
			'depot_tools',
		]);

		try {
			pushDir('depot_tools');
			$('gclient');
		} finally {
			popDir();
		}
	}

	setEnvVar('DEPOT_TOOLS_WIN_TOOLCHAIN', '0');
	setEnvVar('DEPOT_TOOLS_UPDATE', '0');
	process.env['PATH'] =
		path.resolve('depot_tools') + path.delimiter + process.env['PATH'];
}

export function boolean(value: any): boolean {
	switch (Object.prototype.toString.call(value)) {
		case '[object String]':
			return ['true', 't', 'yes', 'y', 'on', '1'].includes(
				value.trim().toLowerCase()
			);

		case '[object Number]':
			return value.valueOf() === 1;

		case '[object Boolean]':
			return value.valueOf();

		default:
			return false;
	}
}

/**
 * Walks a directory recursively and calls the filter function for each file/directory
 * @param dir Directory to walk
 * @param filter Function that decides whether to include a file or traverse into a directory
 * @param callback Function called for each matched file
 */
export function walkDir(
	dir: string,
	filter: (filePath: string, stats: fs.Stats) => boolean,
	callback: (filePath: string) => void
) {
	if (!fs.existsSync(dir)) {
		return;
	}

	const entries = fs.readdirSync(dir);

	for (const entry of entries) {
		const fullPath = path.join(dir, entry);
		const stats = fs.statSync(fullPath);

		if (filter(fullPath, stats)) {
			if (stats.isDirectory()) {
				walkDir(fullPath, filter, callback);
			} else if (stats.isFile()) {
				callback(fullPath);
			}
		}
	}
}

/**
 * Simple glob implementation, only supports
 *
 * - *     - matches any number of characters, not including /
 * - *.ext - matches any number of characters, not including /, and ends with .ext
 * - **    - matches any number of characters, including /
 *
 */
export function copyGlob(src: string, dest: string) {
	const normalizedSrc = path.normalize(src);
	const basePath = normalizedSrc.includes('*')
		? path.dirname(normalizedSrc.split('*')[0].replace(/[\/\\]$/, ''))
		: normalizedSrc;

	// Escape special regex characters except for * which we'll handle specially
	const parseGlobToRegex = (pattern: string): RegExp => {
		// Normalize path separators for the current platform
		const normalized = path.normalize(pattern);

		// Escape regex special characters
		let regexPattern = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

		// Replace glob patterns with regex equivalents
		regexPattern = regexPattern
			.replace(/\*\*/g, '__DOUBLE_STAR__')  // Temporary placeholder
			.replace(/\*/g, '[^/\\\\]*')         // Single * matches anything except path separators
			.replace(/__DOUBLE_STAR__/g, '.*');  // ** matches anything including path separators

		return new RegExp(`^${regexPattern}$`);
	};

	// Parse the pattern once
	const regex = parseGlobToRegex(normalizedSrc);

	if (!fs.existsSync(basePath)) {
		return;
	}

	// Make sure destination directory exists
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}

	walkDir(
		basePath,
		(filePath, stats) => {
			// Always traverse directories
			if (stats.isDirectory()) {
				return true;
			}

			// For files, check if they match the pattern
			return regex.test(filePath);
		},
		(filePath) => {
			// Create relative path to maintain directory structure
			const relativePath = path.relative(basePath, filePath);
			const destPath = path.join(dest, relativePath);

			// Create directory structure in destination
			const destDir = path.dirname(destPath);
			if (!fs.existsSync(destDir)) {
				fs.mkdirSync(destDir, { recursive: true });
			}

			// Copy the file
			fs.copyFileSync(filePath, destPath);
		}
	);
}

export function copyFileToDir(src: string, dest: string) {
	if (fs.existsSync(src)) {
		const baseName = path.basename(src);
		const destFile = path.join(dest, baseName)
		const destDir = path.dirname(destFile);

		fs.mkdirSync(destDir, { recursive: true });
		fs.copyFileSync(src, destFile);
	}
}
