import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Red de seguridad de toda la app.
 *
 * Sin esto, cualquier error al renderizar (o un chunk que no bajó) deja el
 * <div id="root"> vacío: la clienta ve una pantalla completamente en blanco,
 * sin mensaje ni botón, y solo se arregla cerrando y volviendo a abrir.
 * Aquí lo convertimos en una pantalla con explicación y botón de recarga.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    // Recarga desde el servidor para tomar el index.html y los chunks nuevos.
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-6 bg-[#FAE5E7]">
        <div className="w-full max-w-sm rounded-2xl border border-[#8C6B6F]/20 bg-white p-6 text-center space-y-4">
          <h1 className="text-lg font-bold text-[#1A1A1A]">No pudimos cargar esta pantalla</h1>
          <p className="text-sm text-[#3D3A3A] leading-snug">
            Puede ser tu conexión o una actualización de la app. Toca el botón para volver a
            cargarla; tus datos y tu compra no se pierden.
          </p>
          <button
            onClick={this.handleReload}
            className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[#8C6B6F] to-[#D9B5BA] hover:opacity-90 transition-opacity text-sm tracking-wide uppercase"
          >
            Recargar
          </button>
          <a
            href="/app"
            className="block text-xs text-[#8C6B6F] underline underline-offset-2"
          >
            Ir a mi panel
          </a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
