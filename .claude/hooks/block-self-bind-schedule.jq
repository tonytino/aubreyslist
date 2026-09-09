if .tool_name == "mcp__Claude_Code_Remote__send_later" then
  {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Self-bind scheduling is blocked in this repo: hourly/self check-in wakeups resend the full conversation on the same session every fire, which has caused runaway token usage. Rely on the reactive subscribe_pr_activity subscription instead. For a genuine recurring check, use create_trigger with create_new_session_on_fire:true or persistent_session_id targeting another session."}}
elif .tool_name == "mcp__Claude_Code_Remote__create_trigger" and ((.tool_input.persistent_session_id // "") == "") and (.tool_input.create_new_session_on_fire != true) then
  {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Self-bind create_trigger (no persistent_session_id, no create_new_session_on_fire) is blocked in this repo: it re-arms the same session and resends full conversation history every fire, which has caused runaway token usage. Rely on the reactive subscribe_pr_activity subscription instead, or set create_new_session_on_fire:true / persistent_session_id for a genuine recurring check."}}
else
  {}
end
