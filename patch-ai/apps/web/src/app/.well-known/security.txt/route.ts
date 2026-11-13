import { appUrl } from "@/lib/app-url";

export function GET() {
  const contact = process.env.SECURITY_CONTACT_EMAIL ?? process.env.ABUSE_CONTACT_EMAIL;
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const lines = [
    contact ? `Contact: mailto:${contact}` : `Contact: ${appUrl()}/security`,
    `Expires: ${expires}`,
    `Policy: ${appUrl()}/security`,
    "Preferred-Languages: en",
  ];
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
