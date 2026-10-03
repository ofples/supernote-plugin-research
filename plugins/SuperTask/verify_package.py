"""Inspect the actual snplg and nested native archive. Uses Python's stdlib."""
from pathlib import Path
import hashlib
import io
import json
import sys
import zipfile

root = Path(__file__).resolve().parent
artifact = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'build/outputs/SuperTask.snplg'
source = json.loads((root / 'PluginConfig.json').read_text(encoding='utf-8'))
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
assert package['dependencies']['react'] == '19.0.0'
assert package['dependencies']['react-native'] == '0.79.2'
assert package['dependencies']['sn-plugin-lib'] == '0.1.65'
with zipfile.ZipFile(artifact) as plugin:
    config = json.loads(plugin.read('PluginConfig.json'))
    for key in ['pluginID', 'pluginKey', 'versionName', 'versionCode', 'author', 'uses-permissions']:
        assert config[key] == source[key], f'Packaged {key} differs from source'
    assert config['pluginID'] == 'supertask001' and config['pluginKey'] == 'SuperTask'
    assert config['nativeCodePackage'] == '/app.npk'
    assert set(config['reactPackages']) == {
        'com.supertask.NoteOpenerPackage', 'com.rnfs.RNFSPackage',
        'org.linusu.RNGetRandomValuesPackage',
    }
    assert plugin.read(config['iconPath'].lstrip('/')).startswith(b'\x89PNG')
    bundle = plugin.read('SuperTask.bundle')
    assert len(bundle) > 1_000_000
    assert b'config.local' not in bundle
    for marker in [b'Review tasks', b'Refine with AI', b'Saved ', b'getLassoElements', b'json_schema']:
        assert marker in bundle, f'Missing JS implementation: {marker}'
    with zipfile.ZipFile(io.BytesIO(plugin.read('app.npk'))) as native:
        libs = [name for name in native.namelist() if name.startswith('lib/') and name.endswith('.so')]
        assert libs == ['lib/arm64-v8a/libnative-lib.so'], libs
        dex = b''.join(native.read(name) for name in native.namelist() if name.endswith('.dex'))
        for marker in [b'Lcom/supertask/TaskStorageModule;', b'Lcom/supertask/NoteOpenerPackage;',
                       b'Lorg/linusu/RNGetRandomValuesModule;']:
            assert marker in dex, f'Missing native implementation: {marker}'
print('Verified', config['versionName'], 'identity, icon, JS, native registration, classes and ARM64 library')
print('Bytes:', artifact.stat().st_size)
print('SHA256:', hashlib.sha256(artifact.read_bytes()).hexdigest())
