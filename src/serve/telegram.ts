const API_BASE = "https://api.telegram.org/bot";

interface TelegramConfig {
  botToken: string;
  chatId: string;
  timeoutMs: number;
}

interface InlineButton {
  text: string;
  callbackData: string;
}

interface ApprovalResult {
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

  return pollForResponse(config, sent.message_id, nonce);
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

  return pollForResponse(config, sent.message_id, nonce);
}

async function pollForResponse(
  config: TelegramConfig,
  messageId: number,
  nonce: string,
): Promise<ApprovalResult> {
  const deadline = Date.now() + config.timeoutMs;
  let offset = 0;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const pollTimeout = Math.min(Math.floor(remainingMs / 1000), 30);
    if (pollTimeout <= 0) {
      break;
    }

    const updates = await apiCall<TelegramUpdate[]>(config.botToken, "getUpdates", {
      offset,
      timeout: pollTimeout,
    });

    for (const update of updates) {
      offset = update.update_id + 1;

      // Handle callback query (button press).
      if (update.callback_query?.data?.startsWith(`${nonce}:`)) {
        const action = update.callback_query.data.slice(nonce.length + 1);

        await apiCall(config.botToken, "answerCallbackQuery", {
          callback_query_id: update.callback_query.id,
        });

        if (action === "approve" || action === "auto_approve") {
          const label = action === "auto_approve" ? "Auto-approved" : "Approved";
          await apiCall(config.botToken, "editMessageText", {
            chat_id: config.chatId,
            message_id: messageId,
            text: `\u2705 ${label} at ${new Date().toLocaleTimeString()}`,
          });
          return { action: action as ApprovalResult["action"] };
        }

        // Reject or Stop: ask for reason via force reply.
        const label = action === "stop" ? "Stopped" : "Rejected";
        await apiCall(config.botToken, "editMessageText", {
          chat_id: config.chatId,
          message_id: messageId,
          text: `\u274C ${label}. Reply with a reason:`,
          reply_markup: {
            force_reply: true,
            selective: true,
          },
        });

        // Poll for the text reply.
        const reason = await pollForTextReply(config, messageId, offset, deadline);

        await apiCall(config.botToken, "editMessageText", {
          chat_id: config.chatId,
          message_id: messageId,
          text: `\u274C ${label}: ${reason}`,
        });

        return {
          action: action as ApprovalResult["action"],
          reason,
        };
      }
    }
  }

  // Timeout: edit message and reject.
  await apiCall(config.botToken, "editMessageText", {
    chat_id: config.chatId,
    message_id: messageId,
    text: "\u23F0 Timed out",
  }).catch(() => {});

  return { action: "reject", reason: "permission request timed out" };
}

async function pollForTextReply(
  config: TelegramConfig,
  originalMessageId: number,
  startOffset: number,
  deadline: number,
): Promise<string> {
  let offset = startOffset;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const pollTimeout = Math.min(Math.floor(remainingMs / 1000), 30);
    if (pollTimeout <= 0) {
      break;
    }

    const updates = await apiCall<TelegramUpdate[]>(config.botToken, "getUpdates", {
      offset,
      timeout: pollTimeout,
    });

    for (const update of updates) {
      offset = update.update_id + 1;

      if (
        update.message?.reply_to_message?.message_id === originalMessageId &&
        update.message.text
      ) {
        return update.message.text;
      }
    }
  }

  return "(no reason provided)";
}
