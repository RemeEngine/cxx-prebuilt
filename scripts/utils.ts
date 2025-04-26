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
