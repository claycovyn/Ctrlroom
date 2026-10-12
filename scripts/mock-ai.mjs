// A stand-in for an OpenAI-compatible model and a SearXNG server, so the end-to-end test
// can exercise @ctrl and @openctrl (tool calls, web search, page reading, docs) offline.
import http from "node:http";

const last = (arr, pred) => [...arr].reverse().find(pred);

function completion(body, port) {
  const msgs = body.messages ?? [];
  const user = msgs.find((m) => m.role === "user")?.content ?? "";
  const question = user.split("The message to answer")[1] ?? user;
  const tools = (body.tools ?? []).map((t) => t.function.name);
  const toolMsgs = msgs.filter((m) => m.role === "tool");
  const call = (name, args) => ({
    role: "assistant",
    content: null,
    tool_calls: [{ id: `call_${toolMsgs.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
  const answer = (content) => ({ role: "assistant", content });

  if (tools.includes("read_doc")) {
    // @openctrl: search the docs, then answer with the first link.
    if (!toolMsgs.length) return call("search_docs", { query: question.replace(/@openctrl/gi, "").trim() });
    const url = toolMsgs[0].content.match(/URL: (\S+)/)?.[1] ?? "";
    return answer(`<think>reasoning that should be hidden</think>From the docs: admins and the owner change roles in **Settings → People**.\n\nMore: ${url}`);
  }
  if (/research|look up|latest/i.test(question) && tools.includes("web_search")) {
    if (!toolMsgs.length) return call("web_search", { query: "ctrl room test topic" });
    if (toolMsgs.length === 1) return call("read_url", { url: `http://127.0.0.1:${port}/page` });
    const title = last(toolMsgs, () => true).content.match(/Title: (.*)/)?.[1] ?? "";
    return answer(`Here's what I found: the page "${title}" says the test topic is going well.\n\nSources:\nhttp://127.0.0.1:${port}/page`);
  }
  return answer("Mock answer: hello from Ctrl.");
}

export function startMockAi(port = 3199) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const message = completion(JSON.parse(raw), port);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }));
      });
      return;
    }
    if (url.pathname === "/search") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [{ title: "Test topic news", url: `http://127.0.0.1:${port}/page`, content: "All about the test topic." }] }));
      return;
    }
    if (url.pathname === "/page") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>Test Topic Weekly</title><script>ignore()</script></head><body><h1>Test topic</h1><p>It is going well.</p></body></html>");
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
