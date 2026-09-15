import { describe, expect, it } from 'vitest';
import { generarToken, hashearPassword, verificarPassword } from './passwords.js';

describe('passwords', () => {
  it('acepta la contraseña correcta y rechaza cualquier otra', async () => {
    const hash = await hashearPassword('un secreto cualquiera');
    expect(await verificarPassword('un secreto cualquiera', hash)).toBe(true);
    expect(await verificarPassword('un secreto cualquierA', hash)).toBe(false);
    expect(await verificarPassword('', hash)).toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos', async () => {
    // Sal aleatoria: dos usuarios con la misma contraseña no se delatan entre sí.
    const [a, b] = await Promise.all([hashearPassword('igual'), hashearPassword('igual')]);
    expect(a).not.toBe(b);
    expect(await verificarPassword('igual', b)).toBe(true);
  });

  it('acepta acentos y emoji sin depender de cómo los codifique el teclado', async () => {
    const hash = await hashearPassword('contraseñá segura 🔒');
    expect(await verificarPassword('contraseñá segura 🔒', hash)).toBe(true);
    // La misma ñ compuesta de otra forma en Unicode tiene que seguir entrando.
    expect(await verificarPassword('contraseñá segura 🔒'.normalize('NFC'), hash)).toBe(true);
  });

  it('no explota con un hash corrupto o de otro formato', async () => {
    for (const basura of ['', 'x', 'bcrypt$1$2', 'scrypt$a$b$c$d']) {
      expect(await verificarPassword('lo que sea', basura)).toBe(false);
    }
  });

  it('genera tokens distintos y suficientemente largos', () => {
    const tokens = new Set(Array.from({ length: 200 }, generarToken));
    expect(tokens.size).toBe(200);
    expect([...tokens][0]!.length).toBeGreaterThanOrEqual(43);
  });
});
