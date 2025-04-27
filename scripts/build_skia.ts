import path from 'node:path';
import fs from 'node:fs';

import { $, copyDir, copyFileToDir, envVar, findSystemClang, gn, python } from './utils.ts';

export function build_skia(installDir: string) {
    const targetOS = envVar('TARGET_OS');
	const targetArch = envVar('TARGET_ARCH');

    const gnArgs = [
		'is_debug=false',
		'is_clang=true',
        'is_official_build=true',
    ];

    if (targetOS === 'windows') {
        gnArgs.push(`clang_win="${findSystemClang()}"`)
    }

    const args = gnArgs.join(' ');
    $(gn(), [
        `--script-executable=${python()}`,
        'gen',
        'gn_out',
        '--ide=json',
        `--args="${args}"`,
    ]);

	$(gn(), [`--script-executable=${python()}`, 'args', 'gn_out', '--list']);

	$('ninja', ['-C', 'gn_out']);

	const libArchDir = path.join(installDir, 'lib', `${targetArch}-${targetOS}`);
	copyFileToDir('./gn_out/obj/v8_monolith.lib', libArchDir);
	copyDir('./include', path.join(installDir, 'include'), { ext: [ '.h', '.md' ] });
}
