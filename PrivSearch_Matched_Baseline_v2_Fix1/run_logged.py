"""Merge a child's output below PowerShell; preserve its actual exit status."""
import argparse,os,subprocess,sys,traceback
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--log',required=True,type=Path);p.add_argument('--tee',action='store_true');p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args()
 command=a.command[1:] if a.command[:1]==['--'] else a.command
 if not command:p.error('Child command required after --')
 a.log.parent.mkdir(parents=True,exist_ok=True);child=None
 try:
  with a.log.open('wb') as log:
   child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
   while True:
    chunk=child.stdout.read1(65536)
    if not chunk:break
    log.write(chunk);log.flush()
    if a.tee:sys.stdout.buffer.write(chunk);sys.stdout.buffer.flush()
   code=child.wait()
  print('NATIVE_PROCESS_EXIT:',code,flush=True)
  return code if code>=0 else 1
 except BaseException:
  if child is not None and child.poll() is None:child.kill();child.wait()
  with a.log.open('ab') as log:log.write(traceback.format_exc().encode('utf-8'))
  print('NATIVE_PROCESS_EXIT: 1; inspect retained log',flush=True)
  return 1
if __name__=='__main__':raise SystemExit(main())
