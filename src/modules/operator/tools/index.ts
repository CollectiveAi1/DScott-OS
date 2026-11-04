import type { AnyTool } from "../registry";
import { BRIEF_TOOLS } from "./brief";
import { CONTACT_TOOLS } from "./contacts";
import { DEAL_TOOLS } from "./deals";
import { LEARNING_TOOLS } from "./learning";
import { MESSAGE_TOOLS } from "./messages";
import { SCHEDULE_TOOLS } from "./schedule";
import { WORK_TOOLS } from "./work";

/**
 * Everything the Operator can do. This list is the security boundary, not the system prompt:
 * nothing here deletes a row, sends a message, reaches an external service, or reads or writes
 * settings, the owner record or stored keys.
 *
 * `tests/operator.registry.test.ts` pins both the full set and the subset that writes, so adding
 * a tool is a deliberate edit to a test rather than a quiet widening of what a model can do.
 */
export const TOOLS: AnyTool[] = [
  ...WORK_TOOLS,
  ...SCHEDULE_TOOLS,
  ...CONTACT_TOOLS,
  ...DEAL_TOOLS,
  ...LEARNING_TOOLS,
  ...MESSAGE_TOOLS,
  ...BRIEF_TOOLS,
];
