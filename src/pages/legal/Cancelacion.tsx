import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import valianceLogo from "@/assets/valiance-pilates-logo.png";
import api from "@/lib/api";

const Cancelacion = () => {
  const navigate = useNavigate();
  const [dynamicPolicy, setDynamicPolicy] = useState("");

  useEffect(() => {
    api.get("/public/settings/policies_settings").then(({ data }) => {
      const value = data?.data;
      const text = typeof value?.cancellation_policy === "string" ? value.cancellation_policy.trim() : "";
      setDynamicPolicy(text);
    }).catch(() => { });
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border px-6 lg:px-[60px] py-4 flex items-center justify-between">
        <button onClick={() => navigate("/")} className="flex items-center bg-transparent border-none cursor-pointer">
          <img src={valianceLogo} alt="Tu Espacio Pilates" className="h-14 w-auto object-contain" />
        </button>
        <button
          onClick={() => navigate(-1)}
          className="text-muted-foreground text-sm hover:text-foreground transition-colors bg-transparent border-none cursor-pointer"
        >
          ← Volver
        </button>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-[0.72rem] tracking-[0.15em] uppercase text-primary font-medium mb-4 flex items-center gap-[10px]">
          <span className="w-[30px] h-[1px] bg-primary inline-block" />
          Legal
        </div>
        <h1 className="font-bebas text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] text-foreground mb-10">
          POLÍTICA DE CANCELACIÓN
        </h1>

        {dynamicPolicy ? (
          <div className="prose-neutral space-y-6 text-[0.92rem] text-muted-foreground leading-[1.8]">
            <p className="text-foreground font-medium">
              Última actualización: {new Date().toLocaleDateString("es-MX")}
            </p>
            <div className="rounded-2xl border border-border bg-secondary/40 p-6 whitespace-pre-wrap leading-[1.9]">
              {dynamicPolicy}
            </div>
          </div>
        ) : (
          <div className="prose-neutral space-y-6 text-[0.92rem] text-muted-foreground leading-[1.8]">
            <p className="text-foreground font-medium">
              Última actualización: 26 de febrero de 2026
            </p>

            <p>
              En <strong className="text-foreground">Tu Espacio Pilates</strong> nos esforzamos por ofrecer la mejor experiencia a todas nuestras alumnas. Las siguientes políticas de cancelación nos permiten mantener un servicio de calidad y garantizar disponibilidad para todas.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">1. Cancelación de reservaciones</h2>

            <div className="rounded-2xl border border-border bg-secondary/50 p-6 space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/30 flex items-center justify-center flex-shrink-0 text-green-400 text-lg">✓</div>
                <div>
                  <h3 className="font-syne font-bold text-foreground text-sm mb-1">Cancelación con más de 8 horas de anticipación</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    La clase se devuelve a su paquete sin penalización. Puede reagendar o cancelar desde la app sin costo.
                  </p>
                </div>
              </div>
              <div className="border-t border-border" />
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center flex-shrink-0 text-yellow-400 text-lg">⚠</div>
                <div>
                  <h3 className="font-syne font-bold text-foreground text-sm mb-1">Cancelación tardía (menos de 8 horas)</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    La clase se marcará como <strong className="text-foreground">utilizada</strong> y se descontará de su paquete. No hay reposición ni reembolso.
                  </p>
                </div>
              </div>
              <div className="border-t border-border" />
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0 text-red-400 text-lg">✗</div>
                <div>
                  <h3 className="font-syne font-bold text-foreground text-sm mb-1">Inasistencia sin aviso (No-show)</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    La clase se pierde automáticamente. No se otorga reposición, crédito ni reembolso.
                  </p>
                </div>
              </div>
            </div>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">2. Cancelación de paquetes</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Los paquetes adquiridos <strong className="text-foreground">no son reembolsables</strong> bajo ninguna circunstancia una vez activados.</li>
              <li>Un paquete se considera activado al momento de tomar la primera clase.</li>
              <li>No se realizan extensiones de vigencia. Los 30 días se cuentan a partir de la primera clase.</li>
              <li>Los paquetes no utilizados dentro de su vigencia expiran automáticamente.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">3. Excepciones</h2>
            <p>
              En casos excepcionales de fuerza mayor (accidente, hospitalización, emergencia médica comprobable), el estudio podrá evaluar caso por caso la posibilidad de:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Congelar temporalmente el paquete (hasta 15 días).</li>
              <li>Extender la vigencia por el periodo de incapacidad comprobada.</li>
            </ul>
            <p>
              Estas excepciones requieren notificación por escrito a <strong className="text-primary">espaciopilatesvm@gmail.com</strong> con documentación de soporte y quedan a criterio de la administración del estudio.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">4. Cancelación de clases por parte del estudio</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Si el estudio cancela una clase por causas imputables (falta de instructora, mantenimiento, etc.), la clase se repondrá automáticamente al paquete de cada alumna afectada.</li>
              <li>Se notificará a las alumnas registradas con la mayor anticipación posible a través de la app y/o WhatsApp.</li>
              <li>En caso de fenómenos naturales o situaciones de fuerza mayor, el estudio podrá cancelar clases sin reposición obligatoria, aunque se hará el mejor esfuerzo por reprogramar.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">5. Cambio de horario</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Para cambiar de horario, primero cancele su reservación actual (con más de 8 horas de anticipación) y reserve la nueva clase disponible.</li>
              <li>Los cambios están sujetos a disponibilidad de cupo.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">6. Impuntualidad</h2>
            <p>
              Existe una tolerancia de <strong className="text-foreground">5 minutos</strong>. Si llega después de este periodo, no se permitirá el acceso a la clase y esta se contará como utilizada. Esto es por seguridad de todas las participantes y respeto al grupo.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">7. Resumen rápido</h2>
            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary">
                    <th className="text-left p-4 font-syne font-bold text-foreground">Situación</th>
                    <th className="text-left p-4 font-syne font-bold text-foreground">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="p-4">Cancelación &gt; 2 hrs antes</td>
                    <td className="p-4 text-green-400">✓ Clase devuelta</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="p-4">Cancelación &lt; 2 hrs antes</td>
                    <td className="p-4 text-yellow-400">⚠ Clase perdida</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="p-4">No-show (sin aviso)</td>
                    <td className="p-4 text-red-400">✗ Clase perdida</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="p-4">Llegada tarde (&gt;5 min)</td>
                    <td className="p-4 text-red-400">✗ Sin acceso, clase perdida</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="p-4">Reembolso de paquete</td>
                    <td className="p-4 text-red-400">✗ No aplica</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="p-4">Emergencia médica comprobable</td>
                    <td className="p-4 text-yellow-400">⚠ Evaluación caso por caso</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">8. Contacto</h2>
            <p>
              Para cualquier duda o aclaración respecto a esta Política de Cancelación:
            </p>
            <ul className="list-none space-y-1">
              <li><strong className="text-foreground">Email:</strong> espaciopilatesvm@gmail.com</li>
              <li><strong className="text-foreground">Teléfono:</strong> 444 548 0352</li>
              <li><strong className="text-foreground">Dirección:</strong> Av. Villa Magna Nte. 600 A, Villa Magna, 78183 San Luis Potosí, S.L.P.</li>
            </ul>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-6 lg:px-[60px] py-6 text-center">
        <p className="text-xs text-muted-foreground/50">© 2026 Tu Espacio Pilates. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};

export default Cancelacion;
