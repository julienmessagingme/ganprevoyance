import { NextResponse } from "next/server";
import { lookupSlug } from "@/lib/redirect/lookup";
import { checkRate } from "@/lib/redirect/rate-limit";
import { getClientIp } from "@/lib/redirect/client-ip";
import { isLinkPreviewBotRich } from "@/lib/redirect/link-preview-bot";
import { getSupabase } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Log JSON structuré pour chaque issue de redirection. Format compatible
 * `docker logs ganprev-app | jq` :
 *
 *   { ts, level, msg, slug, ip, ua, referer, ... }
 *
 * Filtre rapide : `docker logs ... | grep '"msg":"redirect_404"'`
 */
function logRedirectEvent(args: {
  level: "info" | "warn" | "error";
  msg: string;
  slug: string;
  ip: string;
  userAgent?: string | null;
  referer?: string | null;
  extra?: Record<string, unknown>;
}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: args.level,
      msg: args.msg,
      slug: args.slug,
      ip: args.ip,
      ua: args.userAgent ?? null,
      referer: args.referer ?? null,
      ...(args.extra ?? {}),
    })
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const ip = getClientIp(req) ?? "unknown";
  const userAgent = req.headers.get("user-agent");
  const referer = req.headers.get("referer");

  if (!checkRate(ip)) {
    logRedirectEvent({
      level: "warn",
      msg: "redirect_429_rate_limited",
      slug,
      ip,
      userAgent,
      referer,
    });
    return new NextResponse("Trop de requêtes.", { status: 429 });
  }

  let lookup;
  try {
    lookup = await lookupSlug(slug);
  } catch (err) {
    logRedirectEvent({
      level: "error",
      msg: "redirect_503_db_error",
      slug,
      ip,
      userAgent,
      referer,
      extra: { err: err instanceof Error ? err.message : String(err) },
    });
    return new NextResponse("Service indisponible.", { status: 503 });
  }

  if (!lookup) {
    logRedirectEvent({
      level: "warn",
      msg: "redirect_404_unknown_slug",
      slug,
      ip,
      userAgent,
      referer,
    });
    return new NextResponse("Lien introuvable.", { status: 404 });
  }

  // Skip count pour les bots de link-preview (Meta/WhatsApp/Twitter/etc.)
  // qui hit l'URL pour générer la card preview sans vraie navigation
  // utilisateur. On répond quand même 302 — sinon la preview ne se
  // génère pas chez le destinataire. La version "Rich" check aussi l'IP
  // (range Meta) + le Referer (facebook.com), car depuis 2024 Meta spoof
  // l'UA d'un vrai navigateur mobile. Voir lib/redirect/link-preview-bot.
  const botFiltered = isLinkPreviewBotRich({
    userAgent,
    ip: ip === "unknown" ? null : ip,
    referer,
  });

  if (botFiltered) {
    logRedirectEvent({
      level: "info",
      msg: "redirect_302_bot_filtered",
      slug,
      ip,
      userAgent,
      referer,
      extra: { destination: lookup.destinationUrl },
    });
  } else {
    // Fire-and-forget click insert (don't block redirect)
    void getSupabase()
      .from("clicks")
      .insert({
        event_id: lookup.eventId,
        version_id: lookup.versionId,
        ip: ip === "unknown" ? null : ip,
        user_agent: userAgent,
        referer,
      })
      .then(({ error }: { error: { message?: string } | null }) => {
        if (error) {
          logRedirectEvent({
            level: "error",
            msg: "click_insert_failed",
            slug,
            ip,
            userAgent,
            referer,
            extra: { err: error.message ?? null },
          });
        }
      });
    logRedirectEvent({
      level: "info",
      msg: "redirect_302_ok",
      slug,
      ip,
      userAgent,
      referer,
      extra: { destination: lookup.destinationUrl },
    });
  }

  return NextResponse.redirect(lookup.destinationUrl, { status: 302 });
}
