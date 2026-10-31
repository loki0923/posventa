/**
 * Cloud Functions para GestiónPro POS
 * Módulo de Gestión Segura de Usuarios (Admin SDK)
 * 
 * Despliegue: firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Callable Function: deleteOrDisableUser
 * 
 * Deshabilita o elimina una cuenta de Firebase Authentication y purga su perfil
 * en Firestore, garantizando que un usuario eliminado pierda acceso de inmediato
 * y sus tokens sean revocados.
 */
exports.deleteOrDisableUser = functions.https.onCall(async (data, context) => {
    // 1. Validar autenticación del llamante
    if (!context.auth || !context.auth.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado para realizar esta acción.');
    }

    const callerUid = context.auth.uid;
    const { targetUid, action = 'disable' } = data; // action: 'disable' | 'delete'

    if (!targetUid || typeof targetUid !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'El parámetro targetUid es obligatorio.');
    }

    if (targetUid === callerUid) {
        throw new functions.https.HttpsError('failed-precondition', 'No puedes eliminar ni deshabilitar tu propio usuario administrador.');
    }

    // 2. Verificar que el llamante sea administrador del mismo negocio
    const callerDoc = await db.collection('usuarios').doc(callerUid).get();
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Perfil de usuario llamante no encontrado.');
    }

    const callerData = callerDoc.data();
    if (callerData.role !== 'admin' || !callerData.negocioId) {
        throw new functions.https.HttpsError('permission-denied', 'Solo los administradores del negocio pueden gestionar usuarios.');
    }

    // 3. Verificar que el usuario objetivo pertenezca al mismo negocio
    const targetDoc = await db.collection('usuarios').doc(targetUid).get();
    if (targetDoc.exists) {
        const targetData = targetDoc.data();
        if (targetData.negocioId !== callerData.negocioId) {
            throw new functions.https.HttpsError('permission-denied', 'No tienes permisos sobre usuarios de otro negocio.');
        }
    }

    // 4. Ejecutar acción en Firebase Authentication con Admin SDK
    try {
        if (action === 'delete') {
            await admin.auth().deleteUser(targetUid);
        } else {
            // Por defecto, deshabilitar y revocar tokens de sesión (más seguro para auditoría)
            await admin.auth().updateUser(targetUid, { disabled: true });
            await admin.auth().revokeRefreshTokens(targetUid);
        }

        // 5. Eliminar documento de perfil en Firestore
        await db.collection('usuarios').doc(targetUid).delete();

        return {
            success: true,
            message: `Usuario ${targetUid} ${action === 'delete' ? 'eliminado' : 'deshabilitado'} exitosamente.`
        };
    } catch (error) {
        console.error('Error al gestionar usuario en Auth:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Error al procesar la cuenta de usuario.');
    }
});

/**
 * Callable Function: createBusinessUser
 * 
 * Permite a un administrador crear usuarios (cajeros o admins secundarios)
 * sin exponer la sesión en el cliente ni requerir secondaryAuth hack.
 */
exports.createBusinessUser = functions.https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes estar autenticado.');
    }

    const callerUid = context.auth.uid;
    const { email, password, role = 'cajero', nombre } = data;

    if (!email || !password || password.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', 'Datos de usuario inválidos (contraseña mín. 6 caracteres).');
    }

    if (!['admin', 'cajero'].includes(role)) {
        throw new functions.https.HttpsError('invalid-argument', 'Rol inválido.');
    }

    // Verificar permisos del llamante
    const callerDoc = await db.collection('usuarios').doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Solo administradores pueden crear personal.');
    }

    const negocioId = callerDoc.data().negocioId;

    try {
        // Crear en Firebase Auth
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: nombre || email.split('@')[0]
        });

        // Crear perfil en Firestore
        await db.collection('usuarios').doc(userRecord.uid).set({
            email,
            role,
            negocioId,
            nombre: nombre || 'Usuario ' + role,
            fechaCreacion: new Date().toISOString()
        });

        return {
            success: true,
            uid: userRecord.uid,
            email: userRecord.email
        };
    } catch (error) {
        console.error('Error al crear usuario:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Error al crear usuario.');
    }
});
