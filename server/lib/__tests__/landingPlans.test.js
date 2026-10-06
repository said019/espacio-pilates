import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync('src/pages/Index.tsx', 'utf8');
function catalog(livePlans) {
  const scope = {
    livePlans,
    prenatalPlan: livePlans.find(p => p.program === 'prenatal'),
    getEntityProgram: p => p.program,
    PAQUETES: [{ plan: 'Paquete 7 Clases' }],
    CARGOS: [{ plan: 'Inscripción' }],
    PAQUETES_FUNCIONAL: [{ classes: 7 }, { classes: 9 }, { classes: null }],
  };
  const start = source.indexOf('  const functionalPlans =');
  vm.runInNewContext(source.slice(start, source.indexOf('\n  const navigate', start)) + '\nglobalThis.result = { functionalPlans, additionalPlans };', scope);
  return scope.result;
}

it('publica automáticamente la promo y cualquier nuevo paquete', () => {
  const plans = [
    { id: 'promo', name: 'Promo horario fijo', program: 'functional', classLimit: null },
    { id: 'english', name: 'Pilates in English', program: 'pilates', classLimit: 7 },
    { id: 'new', name: 'Nuevo paquete del catálogo', program: 'pilates' },
  ];
  expect(catalog(plans).additionalPlans.map(p => p.id)).toEqual(['promo', 'english', 'new']);
});

it('no confunde la promo sin límite de clases con Funcional Ilimitado', () => {
  const promo = { id: 'promo', program: 'functional', classLimit: null, code: 'promo-horario-fijo' };
  const unlimited = { id: 'unlimited', program: 'functional', classLimit: null, code: 'functional-unlimited' };
  const result = catalog([promo, unlimited]);
  expect(result.functionalPlans[2].id).toBe('unlimited');
  expect(result.additionalPlans.map(p => p.id)).toEqual(['promo']);
});

it('no duplica planes ya mostrados en las secciones existentes', () => {
  expect(catalog([
    { id: 'p7', name: 'Paquete 7 Clases', program: 'pilates' },
    { id: 'registration', name: 'Inscripción', program: 'pilates' },
    { id: 'f7', code: 'functional-7', program: 'functional' },
    { id: 'prenatal', name: 'Prenatal', program: 'prenatal' },
  ]).additionalPlans).toEqual([]);
});
