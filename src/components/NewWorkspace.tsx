import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileCode2, GitBranch, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import type { Input, Workspace } from '../../shared/types';
import { checkoutExample } from '../../shared/example';
export function NewWorkspace({onClose,onCreated}:{onClose:()=>void;onCreated:(workspace:Workspace)=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [mode,setMode]=useState<'example'|'paste'|'github'>('example');
  const [input,setInput]=useState<Input>({title:'My review',fileName:'checkout.ts',nameA:'Agent A',nameB:'Agent B',base:'',agentA:'',agentB:''});
  const [github,setGitHub]=useState({repository:'',refA:'',refB:'',fileName:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [configured,setConfigured]=useState(false);
  useEffect(()=>{ref.current?.showModal();api<{githubConfigured:boolean}>('/config').then(c=>setConfigured(c.githubConfigured)).catch(()=>{});},[]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try{const w=await api<Workspace>(mode==='example'?'/example':mode==='github'?'/github/import':'/workspaces','POST',mode==='example'?{}:mode==='github'?github:input);onCreated(w);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function upload(key:'base'|'agentA'|'agentB',file:File|undefined) {
    if(!file)return;
    if(file.size>100000){setError('Choose a file smaller than 100 KB.');return;}
    try{const content=await file.text();setInput(v=>({...v,[key]:content}));setError('');}catch{setError('Could not read that file. Try pasting the source instead.');}
  }
  return <dialog ref={ref} className="new-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="new-title"><form onSubmit={submit}>
    <div className="dialog-head"><div><span className="eyebrow">START A REVIEW</span><h2 id="new-title">Bring the work together.</h2></div><button type="button" className="icon-button" aria-label="Close new review" onClick={onClose}><X size={20}/></button></div>
    <div className="mode-switch">{([['example','Checkout example',Sparkles],['paste','TypeScript files',FileCode2],['github','GitHub branches',GitBranch]] as const).map(([key,label,Icon])=><button type="button" key={key} className={mode===key?'active':''} onClick={()=>{setMode(key);setError('');}}><Icon size={16}/>{label}</button>)}</div>
    {mode==='example'&&<div className="example-description"><span className="tag gold">FROM THE PROPOSAL</span><h3>Two agents. One validation step.</h3><p>One agent rejects incomplete orders. The other adds field-level schema checks. Explore the shared function, choose which validation runs first, and export working TypeScript.</p><div className="example-steps"><span>01 · Analyze</span><span>02 · Decide</span><span>03 · Export</span></div><p className="muted small">Runs the real analysis engine on a built-in fixture. No API keys required.</p></div>}
    {mode==='paste'&&<div className="input-form"><div className="form-row"><label>Review title<input value={input.title} maxLength={200} required onChange={e=>setInput({...input,title:e.target.value})}/></label><label>File name<input value={input.fileName} required pattern=".*\.ts" onChange={e=>setInput({...input,fileName:e.target.value})}/></label></div><div className="form-row"><label>Agent A name<input value={input.nameA} maxLength={100} required onChange={e=>setInput({...input,nameA:e.target.value})}/></label><label>Agent B name<input value={input.nameB} maxLength={100} required onChange={e=>setInput({...input,nameB:e.target.value})}/></label></div><p className="muted small">Provide three complete versions of the same .ts file. Empty text represents a file that did not exist. Maximum 100 KB per file.</p>
      {(['base','agentA','agentB'] as const).map((key,i)=><label className="source-input" key={key}><span>{['Common base','Agent A revision','Agent B revision'][i]}<input type="file" accept=".ts,text/plain" aria-label={`Upload ${['base','Agent A','Agent B'][i]}`} onChange={e=>void upload(key,e.target.files?.[0])}/></span><textarea spellCheck={false} aria-label={['Common base source','Agent A source','Agent B source'][i]} value={input[key]} onChange={e=>setInput({...input,[key]:e.target.value})} placeholder="Paste TypeScript here…"/></label>)}<button type="button" className="text-button" onClick={()=>setInput(checkoutExample)}>Fill with the checkout example</button>
    </div>}
    {mode==='github'&&<div className="input-form"><p>Read one TypeScript file from two branches. Fuse finds their shared ancestor and saves all three commit IDs with the review.</p><label>Repository<input required placeholder="owner/repository" value={github.repository} onChange={e=>setGitHub({...github,repository:e.target.value})}/></label><div className="form-row"><label>Agent A branch<input required placeholder="feature/request-validation" value={github.refA} onChange={e=>setGitHub({...github,refA:e.target.value})}/></label><label>Agent B branch<input required placeholder="feature/schema-validation" value={github.refB} onChange={e=>setGitHub({...github,refB:e.target.value})}/></label></div><label>TypeScript file path<input required placeholder="src/checkout.ts" value={github.fileName} onChange={e=>setGitHub({...github,fileName:e.target.value})}/></label><div className="notice">{configured?'Server token configured. Your account needs read access to the selected repository.':'Public repositories work without a key. For private repositories, set GITHUB_TOKEN in the server’s .env file with Contents read access.'}</div><p className="muted small">Import only. Fuse does not push code, merge branches, or send messages.</p></div>}
    {error&&<div role="alert" className="error">{error}</div>}
    <div className="dialog-footer"><span className="muted small">Saved locally on this machine</span><button className="button primary" disabled={busy}>{busy?'Analyzing…':mode==='example'?'Open checkout example':'Analyze revisions'}<ArrowRight size={17}/></button></div>
  </form></dialog>;
}
