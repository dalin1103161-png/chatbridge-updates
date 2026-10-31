# SPDX-License-Identifier: AGPL-3.0-only
"""CPU-only, resident bilingual models and token-batched JSON-lines inference."""
import argparse,json,os,re,sys
from pathlib import Path
import ctranslate2
import sentencepiece as spm
HAN=re.compile(r'[\u3400-\u9fff]')
PROTECTED=re.compile(r'(https?://[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D]+)')
def validate(text,target):
 if not isinstance(text,str) or not text.strip() or len(text)>10000 or target not in ['en','zh-Hans']:raise ValueError('每次需要 1–10000 个字符，目标语言为中文或英文。')
class Engine:
 def __init__(self,root):self.root=Path(root);self.models={}
 def load(self,direction):
  if direction in self.models:return self.models[direction]
  folder=self.root/direction
  if not (folder/'model/model.bin').is_file() or not (folder/'sentencepiece.model').is_file():raise FileNotFoundError('Missing local model')
  tokenizer=spm.SentencePieceProcessor(model_proto=(folder/'sentencepiece.model').read_bytes())
  files={p.name:p.read_bytes() for p in (folder/'model').iterdir() if p.is_file()}
  compute='int8' if 'int8' in ctranslate2.get_supported_compute_types('cpu') else 'auto'
  translator=ctranslate2.Translator('chatbridge-'+direction,files=files,device='cpu',compute_type=compute,inter_threads=1,intra_threads=min(4,os.cpu_count() or 1))
  self.models[direction]=(tokenizer,translator)
  return tokenizer,translator
 def translate_many(self,items):
  layouts=[];work=[];values=[]
  for item in items:
   text,target=item['text'],item['target'];validate(text,target)
   direction='zh-en' if target=='en' else 'en-zh'
   if (target=='en' and not HAN.search(text)) or (target=='zh-Hans' and not re.search('[A-Za-z]',text)):
    layouts.append(([text],target));continue
   tokenizer,_=self.load(direction);layout=[]
   for line in re.split('(\r\n|\n|\r)',text):
    if line in ['\r\n','\n','\r'] or not line.strip():layout.append(line);continue
    for part in PROTECTED.split(line):
     if not part:continue
     if PROTECTED.fullmatch(part) or not re.search(r'[A-Za-z\u3400-\u9fff]',part):layout.append(part);continue
     layout.append(re.match(r'^\s*',part).group());indices=[]
     for sentence in re.split(r'(?<=[。！？.!?])\s*',part.strip()):
      if not sentence:continue
      tokens=tokenizer.encode(sentence,out_type=str)
      for start in range(0,len(tokens),96):
       indices.append(len(work));work.append((direction,tokens[start:start+96]));values.append(None)
     layout.append(indices);layout.append(re.search(r'\s*$',part).group())
   layouts.append((layout,target))
  for direction in ['en-zh','zh-en']:
   indices=[i for i,(d,_) in enumerate(work) if d==direction]
   if not indices:continue
   tokenizer,translator=self.load(direction)
   predictions=translator.translate_batch([work[i][1] for i in indices],beam_size=1,max_batch_size=256,batch_type='tokens',max_input_length=0,max_decoding_length=384,disable_unk=True)
   for i,prediction in zip(indices,predictions):values[i]=tokenizer.decode(prediction.hypotheses[0]).replace('▁',' ').strip()
  return [''.join(part if isinstance(part,str) else (' ' if target=='en' else '').join(values[i] for i in part) for part in layout) for layout,target in layouts]
 def translate(self,text,target):return self.translate_many([{'text':text,'target':target}])[0]
def failure(error):
 code='E_MODEL_FILE' if isinstance(error,(FileNotFoundError,PermissionError)) else 'E_INPUT' if isinstance(error,ValueError) else 'E_ENGINE'
 return {'error':'本地翻译失败（'+code+'），请尝试重新启动软件。','code':code}
def main():
 if hasattr(sys.stdin,'reconfigure'):sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
 p=argparse.ArgumentParser();p.add_argument('--models',required=True);p.add_argument('--self-test',action='store_true');a=p.parse_args();engine=Engine(a.models)
 if a.self_test:
  import socket
  def no_network(*args,**kwargs):raise RuntimeError('Network is forbidden during offline verification')
  socket.socket=no_network
  zh,en=engine.translate_many([{'text':'Hello, how are you today?','target':'zh-Hans'},{'text':'你好，今天过得怎么样？','target':'en'}])
  assert HAN.search(zh) and re.search('[A-Za-z]',en) and not HAN.search(en),(zh,en)
  assert engine.translate('Visit https://example.com 😀','zh-Hans').endswith('https://example.com 😀')
  print(json.dumps({'offline':True,'zh':zh,'en':en,'resident_models':len(engine.models)},ensure_ascii=False));return
 for line in sys.stdin:
  request={}
  try:
   request=json.loads(line)
   if 'items' in request:
    items=request['items']
    if not isinstance(items,list) or not 1<=len(items)<=8:raise ValueError('Invalid batch')
    results=[None]*len(items);valid=[];indices=[]
    for i,item in enumerate(items):
     try:validate(item.get('text'),item.get('target'));valid.append(item);indices.append(i)
     except Exception as error:results[i]=failure(error)
    if valid:
     for i,text in zip(indices,engine.translate_many(valid)):results[i]={'text':text}
    response={'id':request.get('id'),'results':results}
   else:response={'id':request.get('id'),'text':engine.translate(request.get('text'),request.get('target'))}
  except Exception as error:response={'id':request.get('id'),**failure(error)}
  print(json.dumps(response,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
