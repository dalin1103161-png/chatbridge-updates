# SPDX-License-Identifier: AGPL-3.0-only
"""Fetch reviewed model archives during the BUILD, never at translation time."""
import argparse, hashlib, json, shutil, subprocess, zipfile
from pathlib import Path
MODELS = {
 'en-zh': ('https://argos-net.com/v1/translate-en_zh-1_9.argosmodel', '433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab'),
 'zh-en': ('https://argos-net.com/v1/translate-zh_en-1_9.argosmodel', '62e7af5a3a48b530e47b7b3e5c78c2de79073ecd815750d2bf3ab35b4a67da2d'),
}
def prepare(dest, cache):
 dest=Path(dest);cache=Path(cache);dest.mkdir(parents=True,exist_ok=True);cache.mkdir(parents=True,exist_ok=True)
 for direction,(url,digest) in MODELS.items():
  archive=cache/(direction+'.argosmodel')
  if not archive.exists():
   part=archive.with_suffix('.part')
   subprocess.run(['curl','--fail','--location','--retry','3','--connect-timeout','30','--max-time','240','--user-agent','Mozilla/5.0 ChatBridge-Model-Builder','--output',str(part),url],check=True)
   part.replace(archive)
  if hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()!=digest: raise ValueError('Model checksum mismatch: '+direction)
  target=dest/direction;target.mkdir(exist_ok=True)
  with zipfile.ZipFile(archive) as z:
   roots={name.split('/')[0] for name in z.namelist()};assert len(roots)==1
   root=next(iter(roots))+'/'
   for item in z.infolist():
    relative=item.filename[len(root):]
    if not relative or item.is_dir():continue
    rel=Path(relative)
    if rel.is_absolute() or '..' in rel.parts:raise ValueError('Unsafe model archive')
    if relative.startswith('model/') or relative in ['sentencepiece.model','metadata.json','README.md']:
     output=target/rel;output.parent.mkdir(parents=True,exist_ok=True)
     with z.open(item) as source,output.open('wb') as file:shutil.copyfileobj(source,file)
   metadata=json.loads((target/'metadata.json').read_text());assert metadata['from_code']+'-'+metadata['to_code']==direction
  (target/'ORIGIN.json').write_text(json.dumps({'url':url,'sha256':digest,'license':'CC-BY-4.0','authors':'Jörg Tiedemann and Santhosh Thottingal','license_url':'https://creativecommons.org/licenses/by/4.0/'},ensure_ascii=False,indent=2),encoding='utf-8')
 (dest/'NOTICE.txt').write_text('Models: OPUS-MT, packaged by Argos Translate. Authors: Jörg Tiedemann and Santhosh Thottingal. Original models licensed CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Model archive sources and hashes are in each ORIGIN.json; citations are in each README.md. ChatBridge uses the model weights without modification. Runtime: CTranslate2 (MIT), SentencePiece (Apache-2.0), NumPy (BSD-3-Clause); bundled runtime retains package license metadata. No cloud translation service is used.',encoding='utf-8')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--dest',required=True);p.add_argument('--cache',required=True);a=p.parse_args();prepare(a.dest,a.cache)
