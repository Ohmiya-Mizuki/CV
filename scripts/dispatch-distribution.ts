import { readFileSync } from 'node:fs';
type PullRequest = {number:number;merged:boolean;base:{ref:string;repo:{full_name:string}};head:{repo:{full_name:string}}};
export function dispatchInput(pr:PullRequest,repository:string){
 if(!pr.merged||pr.base.ref!=='main'||pr.base.repo.full_name!==repository||pr.head.repo.full_name!==repository||!Number.isSafeInteger(pr.number)||pr.number<1)throw new Error('Untrusted merge');
 return {ref:'main',inputs:{pr:String(pr.number),deliver:true}};
}
if(import.meta.main){
 const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!,'utf8'));
 const input=dispatchInput(event.pull_request,process.env.GITHUB_REPOSITORY!);
 const target=process.env.DISTRIBUTION_REPOSITORY;
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target??''))throw new Error('Distribution destination missing');
 const response=await fetch(`https://api.github.com/repos/${target}/actions/workflows/cv-distribution.yml/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CV_DISTRIBUTION_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify(input)});
 if(!response.ok)throw new Error(`Dispatch failed: HTTP ${response.status}`);
 console.log('Distribution requested for merged PR',event.pull_request.number);
}
