const API_BASE = "https://api.telegram.org/bot";

interface TelegramConfig {
  botToken: string;
  chatId: string;
  timeoutMs: number;
  /** When set, only these Telegram user IDs may approve/reject requests. */
  approverIds?: number[];
}

interface InlineButton {
  text: string;
  callbackData: string;
}

export interface ApprovalResult {
  action: "approve" | "reject" | "auto_approve" | "stop";
  reason?: string;
}

async function apiCall<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    ok: boolean;
    result: T;
    description?: string;
  };
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  return data.result;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number };
    message?: TelegramMessage;
    data?: string;
  };
  message?: {
    message_id: number;
    from?: { id: number };
    chat: { id: number };
    text?: string;
    reply_to_message?: TelegramMessage;
  };
}

function isAuthorizedUser(config: TelegramConfig, userId: number | undefined): boolean {
  if (!config.approverIds || config.approverIds.length === 0) {
    return true;
  }
  if (userId === undefined) {
    return false;
  }
  return config.approverIds.includes(userId);
}

// ---------------------------------------------------------------------------
// Shared poller: one getUpdates loop per bot token, dispatching to listeners.
// ---------------------------------------------------------------------------

type UpdateListener = (update: TelegramUpdate) => boolean;

interface PollerState {
  offset: number;
  listeners: Set<UpdateListener>;
  running: boolean;
}

const pollers = new Map<string, PollerState>();

function getPoller(botToken: string): PollerState {
  let state = pollers.get(botToken);
  if (state) {
    return state;
  }

  state = { offset: 0, listeners: new Set(), running: false };
  pollers.set(botToken, state);
  return state;
}

function registerListener(botToken: string, listener: UpdateListener): () => void {
  const state = getPoller(botToken);
  state.listeners.add(listener);

  // Start the poll loop if not already running.
  if (!state.running) {
    state.running = true;
    void runPollLoop(botToken, state);
  }

  return () => {
    state.listeners.delete(listener);
  };
}

async function runPollLoop(botToken: string, state: PollerState): Promise<void> {
  while (true) {
    // Check for listeners before and after each poll cycle to avoid the race
    // where a new listener registers while getUpdates is in-flight and the
    // loop exits before seeing it.
    if (state.listeners.size === 0) {
      // Yield to allow any in-flight registerListener calls to complete.
      await new Promise((r) => setTimeout(r, 0));
      if (state.listeners.size === 0) {
        break;
      }
    }

    try {
      const updates = await apiCall<TelegramUpdate[]>(botToken, "getUpdates", {
        offset: state.offset,
        timeout: 30,
      });

      for (const update of updates) {
        state.offset = update.update_id + 1;

        // Dispatch to all listeners. A listener returns true if it consumed the update.
        for (const listener of state.listeners) {
          if (listener(update)) {
            break;
          }
        }
      }
    } catch {
      // Transient API error; back off briefly and retry.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  state.running = false;
}

// ---------------------------------------------------------------------------
// Keyboard builder
// ---------------------------------------------------------------------------

function buildKeyboard(
  nonce: string,
  buttons: InlineButton[][],
): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        callback_data: `${nonce}:${btn.callbackData}`,
      })),
    ),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function requestRunApproval(
  config: TelegramConfig,
  opts: {
    command: string[];
    cwd: string;
    reason: string;
    secretNames: string[];
  },
): Promise<ApprovalResult> {
  const nonce = crypto.randomUUID().slice(0, 8);
  const secretList = opts.secretNames.map((s) => `  - ${s}`).join("\n");
  const text = [
    "\u{1F511} Secret access request",
    "",
    `Reason: ${opts.reason}`,
    "",
    `Command: ${opts.command.join(" ")}`,
    `Working dir: ${opts.cwd}`,
    "Secrets:",
    secretList,
  ].join("\n");

  const keyboard = buildKeyboard(nonce, [
    [
      { text: "Approve", callbackData: "approve" },
      { text: "Reject", callbackData: "reject" },
    ],
    [
      { text: "Auto-Approve", callbackData: "auto_approve" },
      { text: "Stop", callbackData: "stop" },
    ],
  ]);

  const sent = await apiCall<TelegramMessage>(config.botToken, "sendMessage", {
    chat_id: config.chatId,
    text,
    reply_markup: keyboard,
  });

  return awaitApproval(config, sent.message_id, nonce);
}

export async function requestResumeApproval(config: TelegramConfig): Promise<ApprovalResult> {
  const nonce = crypto.randomUUID().slice(0, 8);
  const text = ["\u{1F504} Resume request", "", "Agent is requesting to resume the session."].join(
    "\n",
  );

  const keyboard = buildKeyboard(nonce, [
    [
      { text: "Approve", callbackData: "approve" },
      { text: "Reject", callbackData: "reject" },
    ],
  ]);

  const sent = await apiCall<TelegramMessage>(config.botToken, "sendMessage", {
    chat_id: config.chatId,
    text,
    reply_markup: keyboard,
  });

  return awaitApproval(config, sent.message_id, nonce);
}

// ---------------------------------------------------------------------------
// Approval state machine driven by shared poller
// ---------------------------------------------------------------------------

function awaitApproval(
  config: TelegramConfig,
  messageId: number,
  nonce: string,
): Promise<ApprovalResult> {
  return new Promise((resolve) => {
    const deadline = Date.now() + config.timeoutMs;
    let waitingForReason = false;
    let rejectionAction: "reject" | "stop" = "reject";

    const timer = setTimeout(() => {
      cleanup();
      apiCall(config.botToken, "editMessageText", {
        chat_id: config.chatId,
        message_id: messageId,
        text: "\u23F0 Timed out",
      }).catch(() => {});
      resolve({ action: "reject", reason: "permission request timed out" });
    }, config.timeoutMs);

    const unregister = registerListener(config.botToken, (update) => {
      if (Date.now() > deadline) {
        return false;
      }

      // Phase 2: waiting for a text reply with the rejection reason.
      if (waitingForReason) {
        if (
          update.message?.reply_to_message?.message_id === messageId &&
          update.message.text &&
          isAuthorizedUser(config, update.message.from?.id)
        ) {
          const reason = update.message.text;
          cleanup();
          const label = rejectionAction === "stop" ? "Stopped" : "Rejected";
          void apiCall(config.botToken, "editMessageText", {
            chat_id: config.chatId,
            message_id: messageId,
            text: `\u274C ${label}: ${reason}`,
          });
          resolve({ action: rejectionAction, reason });
          return true;
        }
        return false;
      }

      // Phase 1: waiting for a callback query (button press).
      if (!update.callback_query?.data?.startsWith(`${nonce}:`)) {
        return false;
      }

      // Reject button presses from unauthorized users.
      if (!isAuthorizedUser(config, update.callback_query.from?.id)) {
        void apiCall(config.botToken, "answerCallbackQuery", {
          callback_query_id: update.callback_query.id,
          text: "You are not authorized to respond to this request.",
        });
        return true;
      }

      const action = update.callback_query.data.slice(nonce.length + 1);

      void apiCall(config.botToken, "answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
      });

      if (action === "approve" || action === "auto_approve") {
        cleanup();
        const label = action === "auto_approve" ? "Auto-approved" : "Approved";
        void apiCall(config.botToken, "editMessageText", {
          chat_id: config.chatId,
          message_id: messageId,
          text: `\u2705 ${label} at ${new Date().toLocaleTimeString()}`,
        });
        resolve({ action: action as ApprovalResult["action"] });
        return true;
      }

      // Reject or Stop: ask for reason via force reply, then wait for text.
      rejectionAction = action === "stop" ? "stop" : "reject";
      waitingForReason = true;
      const label = action === "stop" ? "Stopped" : "Rejected";
      void apiCall(config.botToken, "editMessageText", {
        chat_id: config.chatId,
        message_id: messageId,
        text: `\u274C ${label}. Reply with a reason:`,
        reply_markup: { force_reply: true, selective: true },
      });
      return true;
    });

    const cleanup = () => {
      clearTimeout(timer);
      unregister();
    };
  });
}
