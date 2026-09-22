# Code Symphony

Build a fully functional web application called “DevOrchestra” — a multi-agent LLM framework for automated software development.

CORE GOAL:

The system should improve the accuracy, completeness, consistency, executability, and overall quality of generated applications by assigning different software-development tasks to specialized agents and coordinating them through an iterative, Sprint-based workflow.

IMPORTANT:

Do not build only a UI mockup. Build the actual end-to-end prototype with a working frontend, backend workflow, LLM integration, project/file generation, testing, and iterative correction.

ARCHITECTURE:

User Requirement

      ↓

Requirement Agent

      ↓

Sprint / Planning Manager

      ↓

Architecture Agent

      ↓

Coding Agent

      ↓

Review + Dependency Agent

      ↓

Testing Agent

      ↓

PASS → Final Application

FAIL → Correction → Coding Agent → Testing again

CORE AGENTS:

1. Requirement Agent

- Convert natural-language requirements into structured requirements.

- Extract functional and non-functional requirements.

- Generate user stories.

- Generate acceptance criteria.

- Identify modules/features.

- Return structured JSON.

2. Sprint / Planning Manager

- Break the project into manageable Sprints.

- Create a Product Backlog.

- Assign requirements to Sprints.

- Define implementation order and dependencies.

- Track current Sprint and completed Sprint.

3. Architecture Agent

- Convert Sprint requirements into technical architecture.

- Define frontend, backend, database, APIs, modules and dependencies.

- Generate architecture documentation.

- Optionally generate PlantUML-compatible diagrams.

- Return structured JSON.

4. Coding Agent

- Generate the actual application code from requirements, Sprint tasks and architecture.

- Create and modify project files.

- Maintain the existing project instead of regenerating everything unnecessarily.

- Work Sprint-by-Sprint.

5. Review + Dependency Agent

- Inspect generated files and project structure.

- Identify missing functionality, bad dependencies, architecture violations, incomplete code and obvious code-quality problems.

- Build a basic dependency representation/graph where possible.

- Produce structured review feedback.

- Send actionable corrections back to the Coding Agent.

6. Testing Agent

- Generate appropriate tests.

- Run tests/build commands.

- Capture errors and failures.

- Decide PASS/FAIL.

- When tests fail, create a structured error report and send it to the Coding Agent for correction.

- Continue the correction/testing loop until the Sprint passes or a retry limit is reached.

ORCHESTRATOR:

Create a central Orchestrator that manages:

- agent order

- Sprint state

- project state

- agent inputs/outputs

- retries

- correction loops

- generated files

- test results

- execution logs

Do NOT make every role a separate AI model. Agents are logical roles that can use the same underlying LLM with different system prompts and context.

AI MODEL SELECTION:

Add an “AI Provider” section in the UI.

The user must be able to choose:

1. API Model

- Provider selector

- API key input

- Model name input/dropdown

- Support configurable providers through a backend abstraction so models such as OpenAI/Gemini/Anthropic/etc. can be added without changing the agent architecture.

2. Ollama

- Enable Ollama mode.

- Ollama base URL field, default: http://localhost:11434

- Model field, default: qwen2.5:14b

- Add a “Test Connection” button.

- Add a “Use Ollama” option for the entire workflow.

The selected provider/model must be used by ALL agents unless explicitly configured otherwise.

Keep the LLM provider completely separate from the agent architecture.

UI:

Create a professional dashboard with:

- Project name

- Natural-language requirement input

- AI Provider / Model selector

- Ollama/API configuration

- “Start Development” button

- Current Sprint indicator

- Agent pipeline showing:

  Requirement → Planning → Architecture → Coding → Review → Testing → Correction

- Agent status: Pending / Running / Completed / Failed

- Expandable output for every agent

- Product backlog

- Sprint board

- Architecture/PlantUML view

- Generated project file tree

- Code viewer

- Dependency/review results

- Test cases and test results

- Execution logs

- Retry/correction history

- Final generated application status

- Download/export generated project

PROJECT STATE:

Persist:

- original requirement

- structured requirements

- user stories

- acceptance criteria

- backlog

- Sprints

- architecture

- generated files

- agent outputs

- review results

- dependency information

- test results

- correction history

- timestamps

- selected AI provider/model

SINGLE-LLM BASELINE:

Add a separate “Baseline Mode”.

Baseline Mode:

Requirement → selected LLM → generated application

DevOrchestra Mode:

Requirement → Requirement → Sprint Planning → Architecture → Coding → Review/Dependency → Testing → Correction

This will allow later experimental comparison between a single LLM and our multi-agent architecture.

SAMPLE PROJECT:

Include a simple default test case:

“Build a To-Do application with user registration, login, create/edit/delete tasks, mark tasks complete, and a dashboard.”

The system should be able to use this example to demonstrate the complete workflow.

TECHNICAL REQUIREMENTS:

- Use React for frontend.

- Use a suitable backend service for agent orchestration and LLM/API calls.

- Use structured JSON schemas for all agent outputs.

- Keep agent prompts modular and stored separately.

- Make the Ollama/API provider layer configurable through environment variables.

- Do not hard-code API keys.

- Keep the architecture modular so agents can be changed or added later.

- Use a retry limit to prevent infinite correction loops.

- Provide useful error messages when the selected model/API/Ollama server is unavailable.

CODE EXECUTION:

The generated application must be represented as real files.

The backend should be able to perform basic local project operations such as file creation, modification, build/test execution and capture of stdout/stderr.

For the first prototype, keep execution controlled and intended for a local development environment. Do not add unnecessary production-grade infrastructure.

DESIGN PRINCIPLES:

- Keep the number of core agents limited and purposeful.

- Do not add agents just to increase the agent count.

- Each agent must have a clear responsibility.

- Use structured communication between agents.

- Keep the Sprint-based iterative workflow central.

- Make every stage visible to the user.

- The final goal is a WORKING GENERATED APPLICATION, not merely generated text/code snippets.

Build the complete working prototype now, including the frontend, backend orchestration, agent workflow, provider selection, Ollama support, API model support, project state, file generation, testing loop, and dashboard.Frontend:

React.js + Vite

Tailwind CSS

Backend:

Python + FastAPI

Agent/LLM layer:

Python

LangChain

LangGraph

Pydantic

LLM:

Ollama

Qwen 2.5 14B

External AI:

Configurable API provider layer

(OpenAI / Gemini / Anthropic etc.)

Database / State:

MongoDB

Code execution/testing:

Python subprocess

Node.js/npm for generated JavaScript projects

Architecture diagrams:

PlantUML

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/22eff29b-798e-4a10-8830-c291621b5e85).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
