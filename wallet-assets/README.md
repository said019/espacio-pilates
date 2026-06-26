# 🔐 Wallet Assets — Certificados Apple Wallet

Esta carpeta contiene los certificados para generar pases `.pkpass` reales de Apple Wallet.

> ⚠️ **NUNCA subas estos archivos a Git.** Están protegidos por `.gitignore`.

## 📁 Archivos necesarios

Coloca estos archivos en `wallet-assets/apple-pass/`:

| Archivo | Descripción | Cómo obtenerlo |
|---|---|---|
| `pass.pem` | Certificado de firma del pase | Exportar desde Keychain como .p12, luego extraer con openssl |
| `pass.key` | Llave privada del certificado | Extraer del .p12 con openssl |
| `wwdr.pem` | Certificado intermedio WWDR de Apple | Descargar de Apple y convertir |

## 🔧 Pasos para generar los archivos

### 1. Desde Apple Developer Portal

1. Ve a https://developer.apple.com/account
2. Certificates, Identifiers & Profiles → Pass Type IDs
3. Crea un Pass Type ID (ej: `pass.com.valiancepilates.club`)
4. Crea un certificado para ese Pass Type ID
5. Descarga el `.cer` y haz doble clic para instalarlo en Keychain

### 2. Exportar desde Keychain (Mac)

1. Abre Keychain Access
2. Busca el certificado "Pass Type ID: pass.com...."
3. Click derecho → Export → guarda como `pass.p12` (ponle un password)

### 3. Convertir con OpenSSL

```bash
# Extraer certificado
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out wallet-assets/apple-pass/pass.pem

# Extraer llave privada (sin password)
openssl pkcs12 -in pass.p12 -nocerts -nodes -out wallet-assets/apple-pass/pass.key

# Descargar WWDR G4 de Apple
curl -o /tmp/wwdr.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform DER -in /tmp/wwdr.cer -out wallet-assets/apple-pass/wwdr.pem
```

### 4. Variables de entorno necesarias (Railway)

```
APPLE_TEAM_ID=TU_TEAM_ID
APPLE_PASS_TYPE_ID=pass.com.valiancepilates.club
APPLE_CERT_PASSWORD=     (vacío si usaste -nodes al exportar la key)
```

Los archivos de certificado se leen automáticamente desde `wallet-assets/apple-pass/`.
