"""Catalogs for app.i18n. EN and ES must have the same keys (tested)."""

EN: dict[str, str] = {
    "email.reset.subject": "Reset your password",
    "email.reset.body": (
        "Someone (hopefully you) asked to reset your password.\n\n"
        "Choose a new one:\n{link}\n\n"
        "The link works once and expires in 30 minutes. If you didn't ask, ignore this email."
    ),
    "email.invite.subject": "{who} invited you to {workspace}",
    "email.invite.body": (
        "{who} invited you to join {workspace} as {role}.\n\n"
        "Accept the invitation:\n{link}\n\n"
        "The link works once and expires in 7 days."
    ),
    "email.rule.alert": "alert",
    "email.rule.cleared": "cleared",
    "role.owner": "Owner",
    "role.admin": "Admin",
    "role.viewer": "Viewer",
    "push.aRule": "A rule",
    "push.aDevice": "A device",
    "push.rule_fired": "{rule} fired",
    "push.device_offline": "{device} went offline",
    "push.device_online": "{device} is back online",
    "push.device_health": "{device} needs a look",
    "push.rule_health": "{rule} can't evaluate",
    "push.delivery_failed": "A delivery failed for {rule}",
    "push.newAlert": "New alert",
    "push.openApp": "Open IO Driven for the details.",
}

ES: dict[str, str] = {
    "email.reset.subject": "Restablece tu contraseña",
    "email.reset.body": (
        "Alguien (esperamos que tú) pidió restablecer tu contraseña.\n\n"
        "Elige una nueva:\n{link}\n\n"
        "El enlace sirve una sola vez y vence en 30 minutos. Si no lo pediste, ignora este correo."
    ),
    "email.invite.subject": "{who} te invitó a {workspace}",
    "email.invite.body": (
        "{who} te invitó a unirte a {workspace} como {role}.\n\n"
        "Acepta la invitación:\n{link}\n\n"
        "El enlace sirve una sola vez y vence en 7 días."
    ),
    "email.rule.alert": "alerta",
    "email.rule.cleared": "liberada",
    "role.owner": "Propietario",
    "role.admin": "Administrador",
    "role.viewer": "Lector",
    "push.aRule": "Una regla",
    "push.aDevice": "Un dispositivo",
    "push.rule_fired": "{rule} se disparó",
    "push.device_offline": "{device} se desconectó",
    "push.device_online": "{device} está de nuevo en línea",
    "push.device_health": "{device} necesita revisión",
    "push.rule_health": "{rule} no se puede evaluar",
    "push.delivery_failed": "Falló una entrega de {rule}",
    "push.newAlert": "Nueva alerta",
    "push.openApp": "Abre IO Driven para ver los detalles.",
}

# The API's fixed error messages, in Spanish. Messages built with values
# (f-strings) and anything not listed stay in English.
ERRORS_ES: dict[str, str] = {
    "A workspace needs at least one owner. Make someone else an owner first.": "Un espacio de trabajo necesita al menos un propietario. Primero haz propietario a otra persona.",
    "API key not found": "No se encontró la API key",
    "API keys can't do this": "Las API keys no pueden hacer esto",
    "Alert not found": "No se encontró la alerta",
    "Already a member of this tenant": "Ya es miembro de este espacio de trabajo",
    "Already a member of this workspace": "Ya es miembro de este espacio de trabajo",
    "An account already uses this email. Sign in to accept.": "Ya hay una cuenta con este correo. Inicia sesión para aceptar.",
    "Another zone already has this name.": "Ya hay otra zona con este nombre.",
    "Catalog entry is still in use by one or more devices": "Uno o más dispositivos todavía usan esta plantilla",
    "Catalog entry not found": "No se encontró la plantilla",
    "Choose a password (at least 8 characters).": "Elige una contraseña (al menos 8 caracteres).",
    "Dashboard not found": "No se encontró el dashboard",
    "Device not found": "No se encontró el dispositivo",
    "Email already registered": "Este correo ya está registrado",
    "Failed delivery not found": "No se encontró la entrega fallida",
    "Google sign-in didn't go through. Try again.": "El inicio de sesión con Google no se completó. Inténtalo de nuevo.",
    "Google sign-in isn't set up here.": "El inicio de sesión con Google no está configurado aquí.",
    "Insufficient role": "Tu rol no permite hacer esto",
    "Invalid email or password": "Correo o contraseña incorrectos",
    "Invalid or expired token": "El token no es válido o ya venció",
    "Invalid refresh token": "La sesión no es válida; inicia sesión de nuevo",
    "Invalid, expired or revoked API key": "La API key no es válida, venció o fue revocada",
    "Invitation not found": "No se encontró la invitación",
    "Missing or invalid authorization header": "Falta la autorización o no es válida",
    "No user registered with that email": "No hay ningún usuario registrado con ese correo",
    "Not a member of this tenant": "No eres miembro de este espacio de trabajo",
    "Nothing left to acknowledge": "No queda nada por reconocer",
    "Notification not found": "No se encontró la notificación",
    "Only a rule that runs manually can be a scene.": "Solo una regla de ejecución manual puede ser una escena.",
    "Only an owner can grant, change or remove the Owner role.": "Solo un propietario puede otorgar, cambiar o quitar el rol de Propietario.",
    "Only an owner can rename the workspace": "Solo un propietario puede cambiar el nombre del espacio de trabajo",
    "Only owners and admins can run this rule.": "Solo propietarios y administradores pueden ejecutar esta regla.",
    "Revoke the key before deleting it.": "Revoca la key antes de eliminarla.",
    "Rule not found": "No se encontró la regla",
    "Sign in to register a phone.": "Inicia sesión para registrar un teléfono.",
    "Thanks. We'll reply within one working day.": "Gracias. Respondemos en un día hábil.",
    "There's already a pending invitation for this email. Resend it instead.": "Ya hay una invitación pendiente para este correo. Mejor reenvíala.",
    "This API key belongs to another tenant": "Esta API key pertenece a otro espacio de trabajo",
    "This account is disabled.": "Esta cuenta está desactivada.",
    "This device template is disabled. Enable it or pick another template.": "Esta plantilla está desactivada. Actívala o elige otra plantilla.",
    "This email's account is linked to another Google account. Sign in with your password.": "La cuenta de este correo está vinculada a otra cuenta de Google. Inicia sesión con tu contraseña.",
    "This invitation link isn't valid.": "Este enlace de invitación no es válido.",
    "This phone isn't registered.": "Este teléfono no está registrado.",
    "This reset link isn't valid or has expired. Ask for a new one.": "Este enlace para restablecer no es válido o ya venció. Pide uno nuevo.",
    "Too many failed sign-ins. Wait 15 minutes, or reset your password.": "Demasiados intentos fallidos. Espera 15 minutos o restablece tu contraseña.",
    "Too many messages from here. Try again in an hour, or email us directly.": "Demasiados mensajes desde aquí. Inténtalo en una hora o escríbenos directamente.",
    "User not found or inactive": "Usuario no encontrado o inactivo",
    "Zone not found": "No se encontró la zona",
    "Enter an email address": "Escribe un correo electrónico",
    "This delivery was already retried.": "Esta entrega ya se reintentó.",
    "a rule needs at least one action": "una regla necesita al menos una acción",
    "every condition must name a device": "cada condición debe indicar un dispositivo",
    "If an account uses that email, a reset link is on its way.": "Si alguna cuenta usa ese correo, el enlace para restablecer ya va en camino.",
}
