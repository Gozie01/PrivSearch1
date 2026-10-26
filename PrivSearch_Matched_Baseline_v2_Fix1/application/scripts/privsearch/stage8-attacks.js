'use strict';
const S=require('./stage1-state');
function matrix(queries,reference){
 const choose=(predicate)=>{const q=queries.find(q=>predicate(q)&&reference[q.name]?.count>0);S.check(q,'Stage8 attack prerequisite query missing');return q.name;},single=choose(q=>q.family==='single_keyword'),and=choose(q=>q.family==='and_2'),branch=choose(q=>q.name==='G_overlap_dnf');
 return [
  ['omit_match',single,'completeness clause mismatch'],['false_empty',single,'completeness clause mismatch'],['insert_match',single,'completeness clause mismatch'],['erase_nonempty_branch',branch,'completeness clause mismatch'],
  ['missing_coverage',single,'missing or extra coverage'],['duplicate_coverage',and,'duplicate or unordered coverage'],
  ['row_ciphertext',single,'ciphertext row digest mismatch'],['row_scalar',single,'ciphertext row digest mismatch'],['row_position',single,'ciphertext row digest mismatch'],
  ['coverage_path',single,'Completeness coverage membership failed'],['coverage_count',single,'Completeness coverage'],
  ['response_digest',single,'response request binding mismatch'],['response_revision',single,'response request binding mismatch'],['xset',and,'completeness clause mismatch'],
  ['rsa',single,'RSA row membership failed'],['payload_handle',single,'payload identity/revision mismatch'],['payload_locator',single,'payload membership failed'],
  ['payload_ciphertext',single,'Ciphertext envelope digest mismatch'],['payload_swap',single,'Ciphertext envelope digest mismatch'],
  ['malformed_http',single,'INVALID_HTTP_JSON'],['http_id',single,'HTTP_RESPONSE_IDENTITY_MISMATCH'],['http_pid',single,'HTTP_RESPONSE_IDENTITY_MISMATCH']
 ].map(([fault,query_name,reason])=>({fault,query_name,reason}));
}
function assertRejected(attack,row){S.check(row&&row.name===attack.query_name&&!row.accepted&&row.no_result_released===true&&!row.transport_limit&&typeof row.reason==='string'&&row.reason.toLowerCase().includes(attack.reason.toLowerCase()),'Stage8 expected attack rejection failed: '+attack.fault);return true;}
module.exports={matrix,assertRejected};
