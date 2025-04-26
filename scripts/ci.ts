import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { build_v8 } from './build_v8.ts';
import {
	$,
	maybeSetupDepotTools,
	pushDir,
	restoreDir,
	setupSource,
} from './utils.ts';

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
} finally {
	restoreDir();
}
