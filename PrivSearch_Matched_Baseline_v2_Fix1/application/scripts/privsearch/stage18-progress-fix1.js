'use strict';
const fs=require('node:fs'),path=require('node:path'),S=require('./stage1-state');
class ProgressWriter {
 constructor(out){this.directory=path.join(out,'progress_records');fs.mkdirSync(this.directory);this.sequence=0;this.started=0;this.completed=0;this.receipts=0;}
 save(s){
  S.check(s.started.length>=this.started&&s.rows.length>=this.completed&&s.receipts.length>=this.receipts,'Stage18 checkpoint counts moved backwards');
  const n=this.sequence+1,record={schema:'privsearch-stage18-progress-record-1',sequence:n,run_id:s.run_id,status:s.status,last_progress:s.last_progress||null,started_count:s.started.length,completed_count:s.rows.length,receipt_count:s.receipts.length,new_started_jobs:s.started.slice(this.started),new_completed_rows:s.rows.slice(this.completed),new_receipts:s.receipts.slice(this.receipts),pending_corpora:s.pending_corpora,roles:s.roles.map(r=>({dataset:r.dataset,profile:r.profile,pid:r.pid,server_stopped:r.server_stopped})),failure:s.failure||null};
  // Each pathname is written once. No replace, rename, shared temporary path,
  // append retry or suppression of a genuine local I/O failure is needed.
  fs.writeFileSync(path.join(this.directory,String(n).padStart(8,'0')+'.json'),JSON.stringify(record)+'\n',{flag:'wx'});
  this.sequence=n;this.started=s.started.length;this.completed=s.rows.length;this.receipts=s.receipts.length;
 }
}
module.exports={ProgressWriter};
