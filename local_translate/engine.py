# SPDX-License-Identifier: AGPL-3.0-only
"""CPU-only JSON-lines translator. No network client, cloud key or model download."""
import argparse,json,os,re,sys
from pathlib import Path
import ctranslate2
import sentencepiece as spm
HAN=re.compile(r'[\u3400-\u9fff]')
PROTECTED=re.compile(r'(https?://[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]+)')
class Engine:
 def __init__(self,root):self.root=Path(root);self.direction=None;self.translator=None;self.tokenizer=None
 def load(self,direction):
  if self.direction==direction:return
  folder=self.root/direction
  if not (folder/'model/model.bin').is_file() or not (folder/'sentencepiece.model').is_file():raise ValueError('本地翻译模型缺失，请重新安装完整安装包。')
  self.translator=None;self.tokenizer=None
  self.tokenizer=spm.SentencePieceProcessor(model_proto=(folder/'sentencepiece.model').read_bytes())
  # Read with Python's Unicode-aware filesystem API; native Windows fopen cannot reliably open Chinese install paths.
  files={p.name:p.read_bytes() for p in (folder/'model').iterdir() if p.is_file()}
  self.translator=ctranslate2.Translator('chatbridge-'+direction,files=files,device='cpu',compute_type='auto',inter_threads=1,intra_threads=min(4,os.cpu_count() or 1))
  self.direction=direction
 def translate(self,text,target):
  if not isinstance(text,str) or not text.strip() or len(text)>10000 or target not in ['en','zh-Hans']:raise ValueError('每次需要 1–10000 个字符，目标语言为中文或英文。')
  direction='zh-en' if target=='en' else 'en-zh'
  if (target=='en' and not HAN.search(text)) or (target=='zh-Hans' and not re.search('[A-Za-z]',text)):return text
  self.load(direction)
  result=[]
  for line in re.split('(\r\n|\n|\r)',text):
   if line in ['\r\n','\n','\r'] or not line.strip():result.append(line);continue
   parts=PROTECTED.split(line)
   translated=[]
   for part in parts:
    if not part:continue
    if PROTECTED.fullmatch(part) or not re.search(r'[A-Za-z\u3400-\u9fff]',part):translated.append(part);continue
    prefix=re.match(r'^\s*',part).group();suffix=re.search(r'\s*$',part).group()
    sentences=re.split(r'(?<=[。！？.!?])\s*',part.strip());outputs=[]
    for sentence in sentences:
     if not sentence:continue
     tokens=self.tokenizer.encode(sentence,out_type=str)
     batches=[tokens[i:i+96] for i in range(0,len(tokens),96)]
     if not batches:continue
     predictions=self.translator.translate_batch(batches,beam_size=2,max_input_length=0,max_decoding_length=512,disable_unk=True)
     for prediction in predictions:outputs.append(self.tokenizer.decode(prediction.hypotheses[0]).replace('▁',' ').strip())
    translated.append(prefix+(' ' if target=='en' else '').join(outputs)+suffix)
   result.append(''.join(translated))
  return ''.join(result)
def main():
 if hasattr(sys.stdin,'reconfigure'):sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
 p=argparse.ArgumentParser();p.add_argument('--models',required=True);p.add_argument('--self-test',action='store_true');a=p.parse_args();engine=Engine(a.models)
 if a.self_test:
  import socket
  def no_network(*args,**kwargs):raise RuntimeError('Network is forbidden during offline verification')
  socket.socket=no_network
  zh=engine.translate('Hello, how are you today?','zh-Hans');en=engine.translate('你好，今天过得怎么样？','en')
  assert HAN.search(zh),(zh,en)
  assert re.search('[A-Za-z]',en) and not HAN.search(en),(zh,en)
  assert engine.translate('Visit https://example.com 😀','zh-Hans').endswith('https://example.com 😀')
  print(json.dumps({'offline':True,'zh':zh,'en':en},ensure_ascii=False));return
 for line in sys.stdin:
  request={}
  try:
   request=json.loads(line);output=engine.translate(request.get('text'),request.get('target'));response={'id':request.get('id'),'text':output}
  except Exception as error:
   code='E_MODEL_FILE' if isinstance(error,(FileNotFoundError,PermissionError)) else 'E_INPUT' if isinstance(error,ValueError) else 'E_ENGINE'
   response={'id':request.get('id'),'error':'本地翻译失败（'+code+'），请尝试重新启动软件。','code':code}
  print(json.dumps(response,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
