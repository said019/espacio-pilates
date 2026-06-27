import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import valianceLogo from "@/assets/valiance-pilates-logo.png";
import api from "@/lib/api";

const Privacidad = () => {
  const navigate = useNavigate();
  const [dynamicPolicy, setDynamicPolicy] = useState("");

  useEffect(() => {
    api.get("/public/settings/policies_settings").then(({ data }) => {
      const value = data?.data;
      const text = typeof value?.privacy_policy === "string" ? value.privacy_policy.trim() : "";
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
          AVISO DE PRIVACIDAD
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

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">1. Responsable del tratamiento</h2>
            <p>
              <strong className="text-foreground">Tu Espacio Pilates</strong>, con domicilio en Av. Villa Magna Nte. 600 A, Villa Magna, 78183 San Luis Potosí, S.L.P., es responsable del tratamiento de los datos personales que recabamos de usted, en los términos de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">2. Datos personales que recabamos</h2>
            <p>Para las finalidades señaladas, recabamos las siguientes categorías de datos personales:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">Datos de identificación:</strong> nombre completo, fecha de nacimiento, género, fotografía de perfil.</li>
              <li><strong className="text-foreground">Datos de contacto:</strong> correo electrónico, número de teléfono, dirección.</li>
              <li><strong className="text-foreground">Datos de salud:</strong> condiciones médicas relevantes (embarazo, lesiones, padecimientos), contacto de emergencia.</li>
              <li><strong className="text-foreground">Datos financieros:</strong> información de pago para la adquisición de paquetes y membresías.</li>
              <li><strong className="text-foreground">Datos de uso:</strong> historial de reservaciones, asistencias, preferencias de clase.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">3. Finalidades del tratamiento</h2>
            <p>Sus datos personales serán utilizados para las siguientes finalidades primarias:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Registro y administración de su cuenta de usuario.</li>
              <li>Gestión de reservaciones y asistencia a clases.</li>
              <li>Procesamiento de pagos y facturación.</li>
              <li>Administración de paquetes, membresías y programas de lealtad.</li>
              <li>Contacto para confirmaciones, recordatorios y notificaciones del servicio.</li>
              <li>Garantizar la seguridad durante las clases, conociendo su estado de salud.</li>
            </ul>
            <p>Finalidades secundarias (opcionales):</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Envío de promociones, ofertas y comunicaciones comerciales.</li>
              <li>Encuestas de satisfacción y mejora del servicio.</li>
              <li>Publicación de fotografías o videos del estudio en redes sociales y materiales publicitarios.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">4. Transferencias de datos</h2>
            <p>
              No transferimos sus datos personales a terceros sin su consentimiento, salvo en los casos previstos por la LFPDPPP y su Reglamento. Sus datos pueden ser compartidos con proveedores de servicios tecnológicos (hosting, pasarelas de pago) que operan bajo estrictas medidas de confidencialidad.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">5. Derechos ARCO</h2>
            <p>
              Usted tiene derecho a Acceder, Rectificar, Cancelar u Oponerse (derechos ARCO) al tratamiento de sus datos personales. Para ejercer estos derechos, envíe una solicitud al correo electrónico <strong className="text-primary">espaciopilatesvm@gmail.com</strong> indicando:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Nombre completo y datos de contacto.</li>
              <li>Descripción clara del derecho que desea ejercer.</li>
              <li>Cualquier documento que facilite la localización de sus datos.</li>
            </ul>
            <p>
              Responderemos su solicitud en un plazo máximo de 20 días hábiles a partir de la recepción de la misma.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">6. Medidas de seguridad</h2>
            <p>
              Implementamos medidas de seguridad administrativas, técnicas y físicas para proteger sus datos personales contra daño, pérdida, alteración, destrucción o uso, acceso o tratamiento no autorizado. Utilizamos cifrado SSL/TLS para la transmisión de datos y almacenamiento seguro en servidores protegidos.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">7. Uso de cookies</h2>
            <p>
              Nuestra plataforma web utiliza cookies y tecnologías de rastreo para mejorar su experiencia de navegación, recordar sus preferencias y analizar el tráfico. Puede configurar su navegador para rechazar cookies, aunque esto podría limitar algunas funcionalidades.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">8. Cambios al aviso de privacidad</h2>
            <p>
              Nos reservamos el derecho de modificar el presente Aviso de Privacidad. Cualquier cambio será publicado en nuestra plataforma web y, en caso de cambios significativos, le notificaremos a través de su correo electrónico registrado.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">9. Contacto</h2>
            <p>
              Si tiene alguna duda o comentario sobre este Aviso de Privacidad, puede contactarnos en:
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

export default Privacidad;
