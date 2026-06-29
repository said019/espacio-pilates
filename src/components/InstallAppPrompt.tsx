import { Share, PlusSquare } from "lucide-react";

const InstallAppPrompt = () => (
  <div className="rounded-xl border border-[#8C6B6F]/15 bg-[#FBF6F4] p-4 space-y-2">
    <p className="text-sm font-medium">Activa las notificaciones en tu iPhone</p>
    <p className="text-xs text-muted-foreground">
      En iPhone, las notificaciones solo funcionan si agregas la app a tu pantalla de inicio:
    </p>
    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
      <li className="flex items-center gap-1">
        Toca <Share size={14} className="inline" /> (Compartir) en la barra de Safari
      </li>
      <li className="flex items-center gap-1">
        Elige <PlusSquare size={14} className="inline" /> "Agregar a inicio"
      </li>
      <li>Abre la app desde el ícono y vuelve aquí para activarlas</li>
    </ol>
  </div>
);

export default InstallAppPrompt;
