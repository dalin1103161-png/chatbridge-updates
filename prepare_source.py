#!/usr/bin/env python3
"""Prepare a pinned Signal Desktop fork without touching its history/media protocol."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

SOURCE_URL = 'https://github.com/signalapp/Signal-Desktop.git'
SOURCE_TAG = 'v8.33.0'
SOURCE_SHA = 'be0ed1340b9798323d59129b43504062d235e23d'
ROOT = Path(__file__).resolve().parent
PRESERVED = ['ts/services/backups/index.preload.ts', 'ts/textsecure/AccountManager.preload.ts']


def replace_once(path, before, after):
    contents = path.read_text(encoding='utf-8')
    if contents.count(before) != 1:
        raise ValueError(f'Expected exactly one patch anchor in {path.name}; stopping.')
    path.write_text(contents.replace(before, after), encoding='utf-8')


def prepare(destination, existing=False):
    destination = Path(destination).resolve()
    if not existing:
        if destination.exists():
            raise ValueError('Destination already exists; use a fresh directory.')
        subprocess.run(['git', 'clone', '--depth', '1', '--branch', SOURCE_TAG, SOURCE_URL, str(destination)], check=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=destination, text=True).strip()
    if revision != SOURCE_SHA:
        raise ValueError('Upstream commit does not match the pinned reviewed revision.')
    status = subprocess.check_output(['git', 'status', '--porcelain'], cwd=destination, text=True)
    if status.strip():
        raise ValueError('Source tree contains changes; will not overwrite them.')
    preserved = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in PRESERVED}
    shutil.copytree(ROOT / 'extension', destination / 'chatbridge')
    # fs-xattr is a macOS-only optional dependency, absent on Windows.
    # Its only use is platform-guarded; retain strict checking of that call.
    if __import__('sys').platform == 'win32':
        (destination / 'ts/chatbridge-fs-xattr.d.ts').write_text(
            "declare module 'fs-xattr' {\n"
            "  export function setAttribute(path: string, name: string, value: string): Promise<void>;\n"
            "}\n", encoding='utf-8')
    main = destination / 'app/main.main.ts'
    replace_once(main, "import * as updater from '../ts/updater/index.main.ts';",
                 "import * as updater from '../ts/updater/index.main.ts';\nimport { installChatBridge } from '../chatbridge/main.cjs';")
    replace_once(main, '  mainWindow = new BrowserWindow(windowOptions);',
                 '  mainWindow = new BrowserWindow(windowOptions);\n  installChatBridge(mainWindow, rootDir);')
    # Preserve Signal URL handling, but never install official Signal over this fork.
    replace_once(main, '  // Second, start checking for app updates\n',
                 '  // ChatBridge: own updater is not configured; do not replace this fork with official Signal.\n  if (app.getName() === \'ChatBridge\') return;\n\n  // Second, start checking for app updates\n')
    replace_once(main, 'async function forceUpdate() {', "async function forceUpdate() {\n  if (app.getName() === 'ChatBridge') return;")
    profile = destination / 'app/user_config.main.ts'
    replace_once(profile, 'if (userData !== undefined) {',
                 "// Each Signal identity has a separate database and single-instance lock.\nconst chatbridgeProfile = process.env.CHATBRIDGE_SIGNAL_PROFILE || 'default';\nif (chatbridgeProfile !== 'default' && !/^[a-f0-9-]{36}$/.test(chatbridgeProfile)) throw new Error('Invalid ChatBridge profile');\nuserData = chatbridgeProfile === 'default' ? join(app.getPath('appData'), 'ChatBridgeSignal') : join(app.getPath('appData'), 'ChatBridgeSignalProfiles', chatbridgeProfile);\n\nif (userData !== undefined) {")
    wrapper = destination / 'preload.wrapper.ts'
    contents = wrapper.read_text(encoding='utf-8')
    contents += "\n// ChatBridge translation UI is isolated from message scripts.\nimport { installPreload } from './chatbridge/preload.cjs';\nif (!process.env.GENERATE_PRELOAD_CACHE) installPreload();\n"
    wrapper.write_text(contents, encoding='utf-8')
    package_file = destination / 'package.json'
    package = json.loads(package_file.read_text(encoding='utf-8'))
    package['name'] = 'chatbridge-signal-desktop'
    package['productName'] = 'ChatBridge'
    package['description'] = 'Unofficial ChatBridge build based on Signal Desktop, with chat translation and WhatsApp workspaces'
    package['author'] = {'name': 'ChatBridge custom build'}
    package['build']['appId'] = 'local.chatbridge.signal-desktop'
    package['build']['files'].append('chatbridge/**')
    package['build']['win'].pop('signtoolOptions', None)
    package['build']['win']['publish'] = None
    package['build']['win']['artifactName'] = 'ChatBridge-Setup.${ext}'
    package['build']['nsis']['deleteAppDataOnUninstall'] = False
    package['build']['nsis']['oneClick'] = False
    package['build']['nsis']['allowToChangeInstallationDirectory'] = True
    package['build']['win']['signAndEditExecutable'] = False
    package['build']['forceCodeSigning'] = False
    package_file.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name, digest in preserved.items():
        if hashlib.sha256((destination / name).read_bytes()).hexdigest() != digest:
            raise ValueError('History/provisioning source changed unexpectedly: ' + name)
    manifest = {'upstream': SOURCE_URL, 'tag': SOURCE_TAG, 'commit': SOURCE_SHA,
                'history_and_linking_files_preserved': preserved,
                'windows_build_tested': False, 'phone_history_transfer_tested': False,
                'media_transfer_tested': False, 'automatic_app_updates': True, 'build': int(os.environ.get('GITHUB_RUN_ID', '0'))}
    (destination / 'chatbridge/source-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dest', required=True)
    parser.add_argument('--existing', action='store_true')
    args = parser.parse_args()
    print(json.dumps(prepare(args.dest, args.existing), indent=2))
