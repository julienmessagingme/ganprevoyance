import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function AnalyseConversationPage() {
  return (
    <div className="max-w-4xl mx-auto py-2">
      <h1 className="text-2xl font-semibold mb-1">Analyse de conversations</h1>
      <p className="text-zinc-500 mb-6 leading-relaxed">
        Découvrez la fonctionnalité : ConvAnalyzer analyse automatiquement vos
        conversations WhatsApp pour en faire ressortir les thèmes abordés, le ressenti
        des clients et des indicateurs clés, directement dans votre tableau de bord.
      </p>

      <div className="rounded-xl overflow-hidden border bg-black shadow-sm aspect-video">
        <iframe
          src="/convanalyzer-demo.html"
          title="ConvAnalyzer — vidéo de présentation"
          className="w-full h-full border-0"
          allow="autoplay; fullscreen"
        />
      </div>

      <div className="mt-6 rounded-lg border bg-zinc-50 p-4 text-sm text-zinc-600">
        Cette fonctionnalité n’est pas encore activée sur votre espace. Pour en bénéficier,
        contactez votre administrateur.
      </div>

      <div className="mt-6">
        <Link href="/urls" className={buttonVariants({ variant: "outline" })}>
          ← Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
