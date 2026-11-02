---
title: Require approval
description: Make a person approve each call of a tool before it runs, and choose who approves.
---

A tool can wait for a person to approve each call before it runs. The run waits, the approver decides in Salesforce, and the run continues. The agent never approves its own work.

:::note
Approvals need an agent with an [Agent Execution Identity](/setup/execution-identity/). An agent without one runs as the starter and cannot wait for someone else.
:::

## Choose Approval Mode

Each Agent Tool has an **Approval Mode** field. It names who decides each call.

| Approval | What happens |
| --- | --- |
| Not Required (the default) | Every call runs. The agent's policy is not asked. |
| Always Required | Every call waits for the tool's Approver Type. The agent's policy is not asked. |
| Decided by Policy | The agent's policy decides each call: run it, deny it, or wait for a user or queue the policy names. See [Approve by rule](/approvals/policy/). |

## Turn it on

On the Agent Tool:

| Field | What to enter |
| --- | --- |
| Approval | Always Required. |
| Approver Type | Who decides. See below. |
| Approver User or Approver Queue | Depends on Approver Type. |
| Approval Timeout (Minutes) | How long the approver has, from 1 to 10080 (7 days). Blank is 1440 (24 hours). |
| When Approval Expires | Required. **Deny and Continue**: the agent is told the call was not approved and carries on. Use it when a missed deadline is an acceptable answer. **Pause for Operator**: the run pauses with `WAIT_EXPIRED` for an operator. Use it when the run should not finish without the action, for example because the approver was away. **Rescue** asks for approval again with a new deadline, and **Cancel** ends the run. |

The tool page saves without an error when the setup is valid. It refuses an approver, Approval Timeout, or When Approval Expires on a tool whose Approval Mode is Not Required.

## Approver types

| Approver Type | Who decides | Also set |
| --- | --- | --- |
| User | One person. | Approver User |
| Queue | Any member of the queue. | Approver Queue. The queue must support Agent Approval. |
| Anchor Record Owner | The owner of the run's record. | Optional Approver Queue as a backup, used when the owner cannot decide, the record is owned by a queue that cannot hold approvals, or the run has no record. Without a backup, the run pauses. |
| Requester's Manager | The manager of the person who started the run. | |
| Approval Process | Your approval process picks the reviewers, and a relay user with `AgentKernelApprovalRelay` passes the decision back. Saving is refused when no active user has that permission. | |

Every approver needs the `AgentKernelHumanDecision` permission set and read access to the approval.

## Who can never approve

- The execution user. Core refuses an identity whose user holds approval permissions.
- Anyone who is not the assigned user or a member of the assigned queue.

The person who started the run may approve it when they are the assigned approver.

## What the agent tells the approver

Core asks the model to explain every tool call. For a tool whose Approval Mode is Always Required or Decided by Policy, it asks what the call will do, the facts behind it, and each condition it did not confirm with a tool. The approver sees this as the agent's explanation. For other tools, it asks for one sentence on what the call does and why it is needed now. The Agent Run Story shows each call's explanation under The agent's reasoning. Core does not check it, so treat it as a claim, not proof.

## What the run looks like

While it waits, the run's status is **Waiting** and an **Agent Approval** record is open with status **Pending**. The approval ends as **Approved**, **Rejected**, **Expired**, or **Cancelled** (when the run is cancelled).

| Outcome | What happens |
| --- | --- |
| Approved | The tool runs with the exact input that was approved. |
| Rejected | The tool does not run. The agent gets `TOOL_APPROVAL_DENIED` with the approver's comment and continues. |
| Expired | Depends on **When Approval Expires**. |

## Reassign an approval

An approval can be reassigned only to someone who could decide it.

## Cost

Each approval adds 2 jobs and 1 API call when the run continues, plus the wait itself. There are no model calls while it waits.
