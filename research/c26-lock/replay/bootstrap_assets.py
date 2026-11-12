#!/usr/bin/env python3
"""Install pinned original FC23 / FC15 assets into the historical engine's /mnt/data tree.
Never overwrite files that differ from archived bytes. No network access or trade orders.
This package contains original 133 MB FC23 data archive, no API tokens.
"""
from pathlib import Path
from zipfile import ZipFile
import argparse,hashlib,shutil,subprocess,sys
BASE=Path(__file__).resolve().parents[1]
ROOT=Path('/mnt/data');REF=ROOT/'research/FC23_LIVE_PREP_v1'
FILENAME='FC23_原引擎與資料_準備上線完整包_20261108.zip'
EXPECTED_SHA='6cdbaab9c09310d6b8ae878e15087184426533849b4ac78d4603810aa894f1df'

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1<<20),b''):h.update(b)
    return h.hexdigest()

def safe_write(stream,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():
        h=hashlib.sha256()
        while True:
            b=stream.read(1<<20)
            if not b:break
            h.update(b)
        if digest(target)!=h.hexdigest():raise RuntimeError('REFUSING TO OVERWRITE non-identical installed file: '+str(target))
        return 'identical'
    tmp=target.with_suffix(target.suffix+'.partial_c26')
    h=hashlib.sha256()
    try:
        with tmp.open('wb') as out:
            while True:
                b=stream.read(1<<20)
                if not b:break
                out.write(b);h.update(b)
        tmp.replace(target)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return 'extracted'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true')
    parser.add_argument('--no-fc15-replay',action='store_true',help='skip initial original FC15 installer, only if base installed already')
    args=parser.parse_args()
    pkg=BASE/'payload'/FILENAME
    if not pkg.exists():
        raise FileNotFoundError(f'Full historical data payload not found: {pkg}. Download full version instead of code-only ZIP.')
    assert digest(pkg)==EXPECTED_SHA, 'Wrong/damaged original base FC23 package'
    if args.verify_only:
        assert (REF/'reference'/ 'FC20_盤後法人與動態同儕可重現特徵.npz').exists()
        assert (REF/'reference'/ 'FC17_當時可知60日動態同儕強勢比例.npz').exists()
        assert (ROOT/'FC15_micro_rank.py').exists()
        assert (ROOT/'R1748_FC08_work/setup_reproduce.py').exists()
        print('ASSETS_INSTALLED',REF,'original_SHA',EXPECTED_SHA,flush=True)
        return 0
    # The original archive paths are all FC23_LIVE_PREP_v1/..., placed in /mnt/data/research/FC23_LIVE_PREP_v1.
    with ZipFile(pkg) as z:
        assert z.testzip() is None
        for e in z.infolist():
            if e.is_dir():continue
            p=Path(e.filename)
            assert not p.is_absolute() and '..' not in p.parts
            assert p.parts[0]=='FC23_LIVE_PREP_v1'
            rel=Path(*p.parts[1:])
            # Only immutable original reference sources/data: old snapshot audit.json and website artifacts are NOT inputs to C26.
            if not rel.parts or rel.parts[0]!='reference':continue
            dest=REF/rel
            with z.open(e) as f:safe_write(f,dest)
    # Install original FC15 source/data and its hard-coded /mnt/data runtime.
    nested=REF/'reference'/'R1748_FC15_LOCK_v1_完整資料_引擎_程式_逐筆重現_20261108.zip'
    with ZipFile(nested) as z:
        for e in z.infolist():
            if e.is_dir():continue
            p=Path(e.filename)
            assert not p.is_absolute() and '..' not in p.parts
            # Restore immutable dependency archives / installer, NOT old FC15 run outputs that may have changed.
            if not (len(p.parts)>=3 and p.parts[1]=='payload') and p.name!='INSTALL_AND_REPLAY.py':continue
            with z.open(e) as f:safe_write(f,ROOT/p)
    installer=ROOT/'R1748_FC15_LOCK_v1/INSTALL_AND_REPLAY.py'
    if not args.no_fc15_replay:
        subprocess.run([sys.executable,str(installer)],check=True)
    for src in (REF/'reference/sources').iterdir():
        with src.open('rb') as f:safe_write(f,ROOT/src.name)
    for fn,target_dir in [
        ('FC17_當時可知60日動態同儕強勢比例.npz','R1748_FC17_reentry'),
        ('FC20_盤後法人與動態同儕可重現特徵.npz','R1748_FC20_法人同儕_交易日稽核')]:
        with (REF/'reference'/fn).open('rb') as f:safe_write(f,ROOT/target_dir/fn)
    print('INSTALL_READY; historical frozen data ends 2026-10-27. LIVE SIGNALS DISABLED.',flush=True)
    return 0
if __name__=='__main__':sys.exit(main())
