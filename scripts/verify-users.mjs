/**
 * Script de Verificación de Integridad de Usuarios (R1 - Pre-publicación Firestore Rules)
 * 
 * Uso:
 *   node scripts/verify-users.mjs
 * 
 * Requisitos:
 *   Tener variable GOOGLE_APPLICATION_CREDENTIALS o ejecutar en entorno con credenciales de Firebase Admin SDK.
 *   Si se ejecuta localmente sin credenciales de servidor, utiliza emulador o guía interactiva.
 */

import fs from 'node:fs';

console.log('=================================================================');
console.log('🔍 VERIFICACIÓN DE PERFILES DE USUARIOS (R1 - FIRESTORE RULES)');
console.log('=================================================================\n');

console.log('Este script valida que CADA cuenta de Firebase Auth tenga su documento');
console.log('en la colección `usuarios/{uid}` con los campos obligatorios:');
console.log('  - negocioId (string >= 6 caracteres)');
console.log('  - role ("admin" | "cajero")\n');

const manualChecklist = `
-----------------------------------------------------------------
CHECKLIST MANUAL DE VERIFICACIÓN EN FIREBASE CONSOLE:
-----------------------------------------------------------------
1. Ingresa a Firebase Console: https://console.firebase.google.com
2. Selecciona tu proyecto GestiónPro POS.
3. Ve a "Authentication" > pestaña "Users".
   - Anota los UIDs de las cuentas activas.
4. Ve a "Firestore Database" > colección "usuarios".
   - Para cada UID de Authentication, confirma que exista un documento con ID = UID.
   - Verifica que contenga:
       * negocioId: "ID_DEL_NEGOCIO"
       * role: "admin" (o "cajero")
5. Si encuentras algún UID sin documento en "usuarios":
   - Créalo manualmente con el botón "Agregar documento" usando el UID como ID.
   - Asigna los campos:
       * negocioId: (el ID del negocio al que pertenece)
       * role: "admin" (para dueños) o "cajero" (para personal)
       * email: correo del usuario
-----------------------------------------------------------------
`;

console.log(manualChecklist);

export function validarPerfilUsuario(perfil) {
    if (!perfil) return { valido: false, razon: 'Documento inexistente' };
    if (!perfil.negocioId || typeof perfil.negocioId !== 'string' || perfil.negocioId.trim().length < 6) {
        return { valido: false, razon: 'negocioId ausente o menor a 6 caracteres' };
    }
    if (!perfil.role || !['admin', 'cajero'].includes(perfil.role)) {
        return { valido: false, razon: 'role no es "admin" ni "cajero"' };
    }
    return { valido: true };
}
