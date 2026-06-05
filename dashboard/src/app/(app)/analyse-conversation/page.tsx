import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function AnalyseConversationPage() {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <div className="max-w-md text-center px-4">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-zinc-100">
          <Lock className="h-7 w-7 text-zinc-400" />
        </div>
        <h1 className="text-xl font-semibold mb-2">Analyse de conversations</h1>
        <p className="text-sm text-zinc-500 mb-6 leading-relaxed">
          Cette section nécessite un accès spécifique. Contactez votre administrateur
          pour y accéder.
        </p>
        <Link href="/urls" className={buttonVariants({ variant: "outline" })}>
          ← Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
