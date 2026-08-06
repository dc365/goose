from pathlib import Path, PurePosixPath
import io
import os
import shutil
import tarfile
import zlib

first = Path('/tmp/enterprise-bundle-1.bin').read_bytes()
second = Path('/tmp/enterprise-bundle-2.bin').read_bytes()
limit = min(len(first), len(second))
overlap = 0
for size in range(limit, 0, -1):
    if first[-size:] == second[:size]:
        overlap = size
        break
compressed = first + second[overlap:]
inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
expanded = inflater.decompress(compressed)
try:
    expanded += inflater.flush()
except zlib.error:
    pass
print({'first': len(first), 'second': len(second), 'overlap': overlap, 'compressed': len(compressed), 'expanded': len(expanded), 'gzip_eof': inflater.eof})

recovered = Path('/tmp/enterprise-recovered')
shutil.rmtree(recovered, ignore_errors=True)
recovered.mkdir(parents=True)
names = []
stream = io.BytesIO(expanded)
archive = None
try:
    archive = tarfile.open(fileobj=stream, mode='r:')
    while True:
        try:
            member = archive.next()
        except (tarfile.ReadError, EOFError) as exc:
            print({'tar_stopped': repr(exc), 'offset': stream.tell()})
            break
        if member is None:
            break
        name = PurePosixPath(member.name)
        if name.is_absolute() or '..' in name.parts:
            raise SystemExit(f'unsafe archive path: {member.name}')
        if member.issym() or member.islnk() or member.isdev():
            raise SystemExit(f'unsupported archive member: {member.name}')
        target = recovered.joinpath(*name.parts)
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if not member.isfile():
            continue
        try:
            source = archive.extractfile(member)
            data = source.read() if source else b''
        except (tarfile.ReadError, EOFError) as exc:
            print({'truncated_member': member.name, 'expected': member.size, 'error': repr(exc)})
            break
        if len(data) != member.size:
            print({'truncated_member': member.name, 'expected': member.size, 'actual': len(data)})
            break
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        os.chmod(target, member.mode & 0o777)
        names.append(member.name)
finally:
    if archive is not None:
        try:
            archive.close()
        except Exception:
            pass
print({'recovered_files': len(names), 'first_files': names[:10], 'last_files': names[-10:]})
if not names:
    raise SystemExit('bundle did not contain any complete files')
Path('/tmp/enterprise-files.txt').write_text('\n'.join(names) + '\n')
