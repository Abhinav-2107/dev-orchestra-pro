<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules

- Generated apps target one build-free stack (Express `index.js` + plain HTML/CSS/JS in `public/`), defined once as `STACK_RULES` in `src/lib/devorchestra/prompts.ts` — why: no bundler setup means fewer broken outputs and `npm install && npm start` just works.
- `src/lib/devorchestra/quality.ts` runs deterministic checks (empty files, missing entry/imports/deps, missing frontend, stub tests) and the orchestrator forces those into Review and Testing verdicts — why: LLM testers can falsely report PASS.
- No vector database for agent context: the orchestrator sends whole files, prioritising files named in findings — why: generated projects are small enough to fit, and retrieval misses cause agents to rewrite files they can't see.
