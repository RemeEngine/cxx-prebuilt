import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

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

export function findSystemClang(): string {
	const clangBasePath = path.resolve(envVar('CLANG_BASE_PATH'));
	const clangPath = path.join(clangBasePath, 'bin', 'clang');
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

export function $(command: string, args: string[]) {
	const ret = spawnSync(command, args, { stdio: ['ignore', 1, 1] });
	if (ret.status !== 0) {
		console.log(ret);
		throw new Error(
			`Command "${command} ${args.join(' ')}" exited with code ${
				ret.status
			}`
		);
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
		process.chdir(repo);
		$('git', ['pull']);
		$('git', ['checkout', info.branch]);
		$('git', ['submodule', 'update', '--init', '--recursive']);
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
}
