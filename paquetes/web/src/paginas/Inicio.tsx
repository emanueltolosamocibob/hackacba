// =============================================================================
// Home: el Formulario 08 digital. Le habla a alguien que no conoce FlotaBot:
// explica que hace y por que importa antes de pedir un numero. Los dos campos
// de telefono no dan de alta: llevan a /agregar.
// =============================================================================

import '../componentes/landing/landing.css';
import { Encabezado } from '../componentes/landing/Encabezado';
import { Hero } from '../componentes/landing/Hero';
import { Ahorro } from '../componentes/landing/Ahorro';
import { Pasos } from '../componentes/landing/Pasos';
import { Desglose } from '../componentes/landing/Desglose';
import { CatalogoVencimientos } from '../componentes/landing/CatalogoVencimientos';
import { Adhesion } from '../componentes/landing/Adhesion';
import { Pie } from '../componentes/landing/Pie';

export function Inicio() {
  return (
    <div className="landing bg-guilloche-official text-dgr-ink-black font-sans antialiased min-h-screen selection:bg-emerald-200 selection:text-dgr-green-dark">
      <Encabezado />
      <main className="relative z-10">
        <Hero />
        <Ahorro />
        <Pasos />
        <Desglose />
        <CatalogoVencimientos />
        <Adhesion />
      </main>
      <Pie />
    </div>
  );
}
