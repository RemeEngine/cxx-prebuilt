import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { build_skia } from './build_skia.ts';
import { build_v8 } from './build_v8.ts';
import { build_angle } from './build_angle.ts';
import { $, maybeSetupDepotTools, pushDir, python, restoreDir, setupSource } from './utils.ts';

const args = process.argv.slice(2);
const enableAsan = args.includes('--asan');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const installDir = path.join(root, 'dist');
pushDir(root);

try {
	maybeSetupDepotTools();

	if (args.includes('v8')) {
		setupSource('v8');

		pushDir(path.join(root, 'v8'));

		$('gclient', ['sync']);
		build_v8(enableAsan, path.join(installDir, 'v8'));
	}

	if (args.includes('skia')) {
		setupSource('skia');

		pushDir(path.join(root, 'skia'));

		$(python(), ['tools/git-sync-deps']);
		build_skia(path.join(installDir, 'skia'));
	}

	if (args.includes('angle')) {
		setupSource('angle');

		pushDir(path.join(root, 'angle'));

		$('gclient', ['sync']);
		build_angle(enableAsan, path.join(installDir, 'angle'));
	}
} finally {
	restoreDir();
}
