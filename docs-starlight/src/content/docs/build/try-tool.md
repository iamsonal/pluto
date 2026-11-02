---
title: Try a tool
description: Run a saved tool once in Pluto Console, as the agent would, and see what it returns. Nothing is kept.
---

**Try Tool** runs a saved tool once with input you type. It runs as you, then undoes everything. Use it to check a query, a field list, or a Flow before a real run.

## Try it

1. Open the tool in Pluto Console and save it. Try Tool uses the saved settings.
2. Click **Try Tool**, next to **Edit**.
3. Under **What the agent sends**, fill in the input. Pluto Console shows one field per input. Click **JSON** to type the input instead.
4. If the tool acts on the run's record, enter that record's Id.
5. Click **Run**.

The next screen shows whether the tool succeeded or failed, the error if it failed, how long it took, how many record changes were undone, and who it ran as. Under that is the output the agent gets back. Open **What the agent sent** to see the input this result answers.

Click **Change input** to go back with your values kept, or **Run Again** to run the same input again.

If the tool refuses the input, for example a text value where it needs a number, the tool does not run. Pluto Console stays on the input, shows the message the agent would get, and marks the field it is about.

## Who it runs as

Try Tool always runs as you, even when the agent has an Agent Execution Identity. It reads and changes only what you can, so it can succeed where the agent would be refused.

For a Query Records, Create Record, or Update Record tool on an agent with an Agent Execution Identity, Try Tool also checks the execution user. If that user cannot read, create, or edit something the tool names, a warning above the input and the result names each object or field, for example `cannot read Account.AccountNumber`. The dry run still runs. To fix it, give the execution user that access in a permission set, or remove those fields from the tool.

Saving a tool does not check the execution user's access. Custom Apex and Flow tools are not checked, because Pluto cannot see what they read.

## What it cannot do

- Only tools whose tool type's Effects is **Stays in This Org** can be tried. A callout cannot be undone. Test the others in a real run.
- It skips approvals and policies, and leaves no Agent Run.
- You need edit access to Agent Tools.
