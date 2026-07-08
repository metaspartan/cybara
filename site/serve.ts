import { serve, file } from "bun";
import { join, resolve, sep } from "path";

const root = resolve(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 3399);
const indexPath = join(root, "index.html");

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = resolve(root, `.${requested}`);

  if (target !== root && !target.startsWith(root + sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  const candidate = file(target);
  if (await candidate.exists()) {
    return new Response(candidate);
  }

  return new Response(file(indexPath), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

serve({ port, hostname: "0.0.0.0", fetch: respond });

console.log(`Cybara site serving on http://0.0.0.0:${port}`);
