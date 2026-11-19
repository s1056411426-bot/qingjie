from pathlib import Path
import hashlib
import shutil
import zipfile
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
release = root / 'release'
docs = root / 'docs'
docs.mkdir(exist_ok=True)
for source, target in [('08-portable-home.png', 'home-preview.png'), ('02-editor.png', 'editor-preview.png')]:
    shutil.copy2(root / '.test-output' / source, docs / target)

with zipfile.ZipFile(release / f'Qingjie-{version}-windows-folder.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted((release / 'win-unpacked').rglob('*')):
        if file.is_file():
            archive.write(file, Path('Qingjie') / file.relative_to(release / 'win-unpacked'))
    archive.write(root / 'README.md', 'Qingjie/使用说明.md')
    archive.write(docs / '验收说明.md', 'Qingjie/docs/验收说明.md')

top_files = ['package.json', 'package-lock.json', '.gitignore', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']
with zipfile.ZipFile(release / f'Qingjie-{version}-source.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in top_files:
        archive.write(root / name, 'qingjie/' + name)
    for folder in ['src', 'scripts', 'tests', '.github', 'docs']:
        for file in sorted((root / folder).rglob('*')):
            if file.is_file() and file.name != 'inspect-portable.cjs':
                archive.write(file, Path('qingjie') / file.relative_to(root))
    for name in ['entitlements.mac.plist', 'models.json', 'logo-source.png']:
        archive.write(root / 'assets' / name, 'qingjie/assets/' + name)

lines = []
for file in sorted(release.iterdir()):
    if file.suffix in {'.exe', '.zip'}:
        digest = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()
        lines.append(digest + '  ' + file.name)
        print(f'{file.name}: {file.stat().st_size / 1024 / 1024:.1f} MB')
(release / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
