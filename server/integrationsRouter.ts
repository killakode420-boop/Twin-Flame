import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { getConnectorsState } from "./integrations/connectors";
import {
  dispatchCopilotTaskInputSchema,
  dispatchCopilotTask,
  syncManusTaskInputSchema,
  syncManusTaskToCopilot,
} from "./integrations/copilotAgents";
import {
  createManusTask,
  createManusTaskInputSchema,
  getManusTask,
  isManusConfigured,
  listManusTasks,
  listManusTasksInputSchema,
} from "./integrations/manus";

/**
 * Org-automation surface for the GalyVverse hub. Every procedure is
 * admin-only (`adminProcedure`) because these endpoints can read the full
 * Manus task list and open issues in org repositories. Responses never
 * contain secrets — only configured/not-configured booleans and provider
 * payloads with credentials redacted server-side.
 */
export const integrationsRouter = router({
  status: adminProcedure.query(() => ({
    manusConfigured: isManusConfigured(),
    connectors: getConnectorsState(),
  })),
  manus: router({
    listTasks: adminProcedure.input(listManusTasksInputSchema.optional()).query(({ input }) => listManusTasks(input)),
    getTask: adminProcedure.input(z.object({ taskId: z.string().trim().min(1).max(200) })).query(({ input }) => getManusTask(input.taskId)),
    createTask: adminProcedure.input(createManusTaskInputSchema).mutation(({ input }) => createManusTask(input)),
  }),
  copilot: router({
    dispatchTask: adminProcedure.input(dispatchCopilotTaskInputSchema).mutation(({ input }) => dispatchCopilotTask(input)),
    syncFromManus: adminProcedure.input(syncManusTaskInputSchema).mutation(({ input }) => syncManusTaskToCopilot(input)),
  }),
});
