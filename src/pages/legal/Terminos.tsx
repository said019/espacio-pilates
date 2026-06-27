import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import valianceLogo from "@/assets/valiance-pilates-logo.png";
import api from "@/lib/api";

const Terminos = () => {
  const navigate = useNavigate();
  const [dynamicPolicy, setDynamicPolicy] = useState("");

  useEffect(() => {
    api.get("/public/settings/policies_settings").then(({ data }) => {
      const value = data?.data;
      const text = typeof value?.terms_of_service === "string" ? value.terms_of_service.trim() : "";
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
          TÉRMINOS Y CONDICIONES
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
              Al utilizar los servicios de <strong className="text-foreground">Tu Espacio Pilates</strong>, incluyendo nuestra plataforma web, aplicación y clases presenciales, usted acepta los presentes Términos y Condiciones. Le recomendamos leerlos detenidamente.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">1. Definiciones</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">"Estudio"</strong> se refiere a Tu Espacio Pilates y sus instalaciones en Iztapalapa, Ciudad de México.</li>
              <li><strong className="text-foreground">"Alumna/o"</strong> se refiere a cualquier persona registrada en la plataforma que asiste a clases.</li>
              <li><strong className="text-foreground">"Paquete"</strong> se refiere a los planes de clases adquiridos (Pilates Reformer o Barre).</li>
              <li><strong className="text-foreground">"Clase"</strong> se refiere a cada sesión de ejercicio programada en el estudio.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">2. Registro y cuenta</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Para acceder a los servicios, es necesario crear una cuenta con información veraz y actualizada.</li>
              <li>Usted es responsable de mantener la confidencialidad de sus credenciales de acceso.</li>
              <li>Debe ser mayor de 16 años para registrarse. Menores de edad requieren autorización de un padre o tutor.</li>
              <li>El estudio se reserva el derecho de suspender o cancelar cuentas que incumplan estos términos.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">3. Paquetes y pagos</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Los precios de los paquetes están expresados en pesos mexicanos (MXN) e incluyen IVA.</li>
              <li>Todos los paquetes tienen una vigencia de <strong className="text-foreground">30 días naturales</strong> a partir de la primera clase tomada.</li>
              <li>Los paquetes <strong className="text-foreground">no son transferibles</strong> a otra persona.</li>
              <li>Los paquetes <strong className="text-foreground">no son reembolsables</strong> una vez adquiridos.</li>
              <li>Las clases no utilizadas dentro del periodo de vigencia se pierden sin derecho a reembolso ni extensión.</li>
              <li>Los pagos deben realizarse antes o el mismo día de la primera clase del paquete.</li>
              <li>Aceptamos pagos en efectivo, transferencia bancaria y tarjeta.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">4. Reservaciones</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Todas las clases requieren <strong className="text-foreground">reservación previa</strong> a través de la plataforma.</li>
              <li>El cupo máximo por clase es de <strong className="text-foreground">10 personas</strong>.</li>
              <li>Las reservaciones pueden realizarse hasta 5 minutos antes del inicio de la clase, sujeto a disponibilidad.</li>
              <li>No se permiten reservaciones por teléfono ni en persona sin confirmar en la plataforma.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">5. Cancelaciones e inasistencias</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Las cancelaciones deben realizarse con un mínimo de <strong className="text-foreground">8 horas de anticipación</strong> al inicio de la clase.</li>
              <li>Cancelaciones tardías (menos de 8 horas) o inasistencias sin aviso resultarán en la <strong className="text-foreground">pérdida de la clase</strong> del paquete.</li>
              <li>No se otorgan reposiciones por cancelaciones tardías ni inasistencias.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">6. Puntualidad</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Se otorgan <strong className="text-foreground">5 minutos de tolerancia</strong> después de la hora programada.</li>
              <li>Una vez iniciada la sesión, no se permitirá el ingreso por seguridad y respeto al grupo.</li>
              <li>La inasistencia por impuntualidad se contará como clase utilizada.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">7. Salud y responsabilidad</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Cada alumna/o es responsable de informar cualquier condición médica, embarazo, lesión o padecimiento <strong className="text-foreground">antes de tomar su primera clase</strong>.</li>
              <li>El estudio no se hace responsable por lesiones derivadas de condiciones médicas no reportadas.</li>
              <li>Se recomienda consultar a un médico antes de iniciar cualquier programa de ejercicio.</li>
              <li>En caso de embarazo o postparto, se requiere autorización médica por escrito.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">8. Vestimenta y artículos personales</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Para todas las clases: ropa deportiva cómoda y <strong className="text-foreground">calcetas antideslizantes</strong>.</li>
              <li>Para clases de pilates: se recomienda ropa ajustada para mejor corrección postural.</li>
              <li>Todos los artículos personales deben guardarse en los lockers proporcionados.</li>
              <li>No se permite llevar objetos personales (incluida agua) al área de mat para evitar accidentes.</li>
              <li>El celular debe permanecer en silencio durante la clase.</li>
              <li>El estudio no se hace responsable por objetos perdidos o robados.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">9. Conducta</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Se espera un comportamiento respetuoso hacia instructoras, personal y demás alumnas.</li>
              <li>No se tolera ningún tipo de discriminación, acoso o conducta inapropiada.</li>
              <li>El estudio se reserva el derecho de negar el servicio a personas que no respeten el código de conducta.</li>
            </ul>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">10. Uso de imagen</h2>
            <p>
              Al asistir al estudio, usted acepta que se pueden tomar fotografías y/o videos del ambiente general de las clases con fines promocionales. Si no desea aparecer en material publicitario, favor de notificarlo al personal antes de la clase.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">11. Modificaciones</h2>
            <p>
              Tu Espacio Pilates se reserva el derecho de modificar los presentes Términos y Condiciones, así como los horarios, precios y políticas del estudio. Los cambios serán publicados en la plataforma y entrarán en vigor al momento de su publicación.
            </p>

            <h2 className="font-syne font-bold text-lg text-foreground mt-8 mb-3">12. Contacto</h2>
            <p>
              Para cualquier duda respecto a estos Términos y Condiciones:
            </p>
            <ul className="list-none space-y-1">
              <li><strong className="text-foreground">Email:</strong> espaciopilatesvm@gmail.com</li>
              <li><strong className="text-foreground">Teléfono:</strong> +52 55 2317 3402</li>
              <li><strong className="text-foreground">Dirección:</strong> Av. Luis Hidalgo Monroy 369, San Miguel, Iztapalapa, 09360 CDMX</li>
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

export default Terminos;
