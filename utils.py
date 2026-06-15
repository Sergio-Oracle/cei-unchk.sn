"""Utilitaires avancés - VERSION CORRIGÉE
- Envoi d'emails (SANS timeout sur starttls - compatible Python < 3.9)
- Détection de doublons (hash)
- Extraction de texte avec OCR
- Export PDF de copies corrigées
"""
import os
import hashlib
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import PyPDF2
import docx
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from io import BytesIO
from datetime import datetime
import re
import unicodedata

# Configuration SMTP — chemin absolu vers .env pour éviter tout problème de répertoire courant
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')

def _smtp_config():
    from dotenv import dotenv_values
    env = dotenv_values(_ENV_PATH)
    return {
        'server':     env.get('SMTP_SERVER', os.getenv('SMTP_SERVER', 'smtp.gmail.com')),
        'port':       int(env.get('SMTP_PORT', os.getenv('SMTP_PORT', 587))),
        'username':   env.get('SMTP_USERNAME', os.getenv('SMTP_USERNAME', '')),
        'password':   env.get('SMTP_PASSWORD', os.getenv('SMTP_PASSWORD', '')),
        'from_email': env.get('SMTP_FROM_EMAIL', os.getenv('SMTP_FROM_EMAIL', 'noreply@examgrading.com')),
        'from_name':  env.get('SMTP_FROM_NAME', os.getenv('SMTP_FROM_NAME', "CEI — Centre d'Examen Intelligent")),
        'app_url':    env.get('APP_URL', os.getenv('APP_URL', 'https://cei.ec2lt.sn')).rstrip('/'),
    }

# Compatibilité ascendante (utilisé dans send_email)
SMTP_SERVER   = 'smtp.gmail.com'
SMTP_PORT     = 587
SMTP_USERNAME = ''
SMTP_PASSWORD = ''
SMTP_FROM_EMAIL = 'noreply@examgrading.com'
SMTP_FROM_NAME  = 'CEI — Centre d\'Examen Intelligent'

# ============================================================================
# DÉTECTION DE DOUBLONS (SHA256)
# ============================================================================

def calculate_file_hash(file_path):
    """Calculer le hash SHA256 d'un fichier"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def calculate_content_hash(content):
    """Calculer le hash SHA256 d'un contenu texte"""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()

# ============================================================================
# EXTRACTION DE TEXTE (avec OCR si nécessaire)
# ============================================================================

def extract_text_from_file(filepath):
    """Extraire le texte d'un fichier PDF, DOCX ou TXT"""
    ext = filepath.lower().split('.')[-1]

    try:
        if ext == 'pdf':
            return extract_text_from_pdf(filepath)
        elif ext in ['docx', 'doc']:
            return extract_text_from_docx(filepath)
        elif ext == 'txt':
            with open(filepath, 'r', encoding='utf-8') as f:
                return f.read()
        else:
            return None
    except Exception as e:
        print(f"⚠️ Erreur extraction texte: {e}")
        return None

def _is_garbled(text):
    """Détecter si le texte extrait est du charabia CIDFont."""
    if not text or len(text) < 20:
        return True

    # Format PyPDF2 : /0 /1 /i255 /3/4 ...
    tokens = text.split()
    if tokens:
        garbled_tokens = sum(1 for t in tokens if re.match(r'^(/[i]?\d+)+$', t))
        if garbled_tokens / len(tokens) > 0.15:
            return True

    # Format pdfplumber : (cid:3) séquences intégrées
    cid_count = len(re.findall(r'\(cid:\d+\)', text))
    if cid_count > 5:
        return True

    # Texte lisible : au moins 50 caractères de vraies lettres latines
    real_chars = re.findall(r'[a-zA-ZÀ-ÿ]', text)
    if len(real_chars) < 50:
        return True

    return False


def _ocr_pdf(filepath):
    """OCR via pdftoppm + tesseract (fallback ultime pour PDFs non décodables)."""
    import subprocess, tempfile, glob
    try:
        res = subprocess.run(['which', 'tesseract'], capture_output=True)
        if res.returncode != 0:
            print("⚠️ tesseract absent — lance en root : apt install -y tesseract-ocr tesseract-ocr-fra")
            return None
        with tempfile.TemporaryDirectory() as tmpdir:
            img_prefix = os.path.join(tmpdir, 'page')
            r = subprocess.run(
                ['pdftoppm', '-r', '200', '-png', filepath, img_prefix],
                capture_output=True, timeout=120
            )
            if r.returncode != 0:
                print(f"⚠️ pdftoppm erreur : {r.stderr.decode()[:200]}")
                return None
            images = sorted(glob.glob(os.path.join(tmpdir, '*.png')))
            if not images:
                return None
            pages_text = []
            for img_path in images:
                out_prefix = img_path.replace('.png', '_ocr')
                subprocess.run(
                    ['tesseract', img_path, out_prefix, '-l', 'fra+eng', '--psm', '6'],
                    capture_output=True, timeout=60
                )
                out_txt = out_prefix + '.txt'
                if os.path.exists(out_txt):
                    with open(out_txt, 'r', encoding='utf-8', errors='replace') as f:
                        pages_text.append(f.read())
            result = '\n'.join(pages_text).strip()
            return result if result else None
    except Exception as e:
        print(f"⚠️ OCR erreur : {e}")
        return None


def extract_text_from_pdf(filepath):
    """Extraire le texte d'un PDF : pdfplumber → PyPDF2 → OCR tesseract."""
    # 1. pdfplumber (meilleur support CMap/CIDFont)
    try:
        import pdfplumber
        pages_text = []
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    pages_text.append(t)
        text = "\n".join(pages_text).strip()
        if text and not _is_garbled(text):
            print(f"✅ pdfplumber OK — {len(text)} caractères")
            return text
        print("⚠️ pdfplumber : texte garbled, bascule PyPDF2")
    except Exception as e:
        print(f"⚠️ pdfplumber erreur : {e}")

    # 2. PyPDF2
    try:
        text = ""
        with open(filepath, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        text = text.strip()
        if text and not _is_garbled(text):
            print(f"✅ PyPDF2 OK — {len(text)} caractères")
            return text
        print("⚠️ PyPDF2 : texte garbled, bascule OCR")
    except Exception as e:
        print(f"⚠️ Erreur PDF PyPDF2: {e}")

    # 3. OCR tesseract (pour PDFs avec polices non-Unicode)
    print("🔍 Tentative OCR tesseract...")
    text = _ocr_pdf(filepath)
    if text and not _is_garbled(text):
        print(f"✅ OCR OK — {len(text)} caractères")
        return text

    print("❌ Impossible d'extraire le texte de ce PDF (police non-Unicode, tesseract requis)")
    return None

def extract_text_from_docx(filepath):
    """Extraire le texte d'un DOCX"""
    try:
        doc = docx.Document(filepath)
        text = "\n".join([para.text for para in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"⚠️ Erreur DOCX: {e}")
        return None

def extract_student_name_from_content_improved(content):
    """Extraction améliorée du nom étudiant
    Évite les patterns incorrects comme "Copie Sdn/..." 
    """
    # Nettoyer le contenu
    content_lines = content.split('\n')

    # Patterns à éviter (false positives)
    avoid_patterns = [
        r'^Copie\s+',
        r'^\d+\.',
        r'^Question\s+',
        r'^Exercice\s+',
        r'^Problème\s+',
        r'^Examen\s+',
        r'^Test\s+',
        r'^Devoir\s+',
    ]

    # Patterns pour trouver le nom
    name_patterns = [
        r'Nom\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Nom\s+et\s+Prénom\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Prénom\s+et\s+Nom\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Nom\s+Prénom\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Étudiant\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Candidat\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Nom\s+complet\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
        r'Élève\s*:\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\s\'-]+)',
    ]

    # Essayer chaque pattern
    for pattern in name_patterns:
        match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
        if match:
            name = match.group(1).strip()

            # Vérifier que ce n'est pas un false positive
            is_valid = True
            for avoid in avoid_patterns:
                if re.match(avoid, name, re.IGNORECASE):
                    is_valid = False
                    break

            if is_valid and len(name) >= 4 and ' ' in name:
                return name

    # Fallback: chercher dans les 10 premières lignes un pattern NOM Prénom
    for line in content_lines[:10]:
        line = line.strip()
        if len(line) < 5 or len(line) > 50:
            continue

        # Vérifier les patterns à éviter
        skip = False
        for avoid in avoid_patterns:
            if re.match(avoid, line, re.IGNORECASE):
                skip = True
                break

        if skip:
            continue

        # Pattern: MAJUSCULE Minuscule (ex: BOUNGUELE Serge)
        match = re.match(r'^([A-ZÀ-Ÿ]{2,})\s+([A-ZÀ-Ÿ][a-zà-ÿ]+)$', line)
        if match:
            return f"{match.group(1)} {match.group(2)}"

        # Pattern: Majuscule MAJUSCULE (ex: Serge BOUNGUELE)
        match = re.match(r'^([A-ZÀ-Ÿ][a-zà-ÿ]+)\s+([A-ZÀ-Ÿ]{2,})$', line)
        if match:
            return f"{match.group(1)} {match.group(2)}"

    return None

extract_student_name_from_content = extract_student_name_from_content_improved

# ============================================================================
# EXPORT PDF DE COPIES CORRIGÉES
# ============================================================================

def generate_corrected_paper_pdf(paper_data, output_path):
    """Générer un PDF de la copie corrigée
    paper_data = {'student_name', 'subject_title', 'score', 'grade', 'corrected_at'}
    """
    doc = SimpleDocTemplate(output_path, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []

    # Style personnalisé
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=colors.HexColor('#2563eb'),
        spaceAfter=30,
        alignment=1 # Centré
    )

    header_style = ParagraphStyle(
        'CustomHeader',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#1e293b'),
        spaceAfter=12
    )

    # En-tête
    story.append(Paragraph("📋 COPIE CORRIGÉE", title_style))
    story.append(Spacer(1, 0.2*inch))

    # Informations
    info_data = [
        ['Étudiant:', paper_data.get('student_name', 'N/A')],
        ['Sujet:', paper_data.get('subject_title', 'N/A')],
        ['Note:', f"{paper_data.get('score', 0)}/20"],
        ['Date:', datetime.fromisoformat(paper_data.get('corrected_at', datetime.now().isoformat())).strftime('%d/%m/%Y')]
    ]

    info_table = Table(info_data, colWidths=[2*inch, 4*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1e293b')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, colors.HexColor('#f8fafc')])
    ]))

    story.append(info_table)
    story.append(Spacer(1, 0.3*inch))

    # Correction détaillée
    story.append(Paragraph("📝 Correction Détaillée", header_style))
    story.append(Spacer(1, 0.1*inch))

    grade_text = paper_data.get('grade', 'Pas de correction disponible')
    for line in grade_text.split('\n'):
        if line.strip():
            story.append(Paragraph(line, styles['BodyText']))
            story.append(Spacer(1, 0.05*inch))

    # Footer
    story.append(Spacer(1, 0.5*inch))
    footer_style = ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#64748b'),
        alignment=1
    )
    story.append(Paragraph("Système de Notation Automatisé - Document généré le " +
                          datetime.now().strftime('%d/%m/%Y à %H:%M'), footer_style))

    # Générer le PDF
    doc.build(story)
    return output_path

# ============================================================================
# ENVOI D'EMAILS — SMTP université (smx7.unchk.sn) → fallback MX direct
# ============================================================================

def _get_mx_host(domain):
    """Résoudre le serveur MX d'un domaine via DNS."""
    import subprocess
    try:
        result = subprocess.run(
            ['python3', '-c',
             f"import dns.resolver; answers=dns.resolver.resolve('{domain}','MX'); "
             f"print(sorted(answers, key=lambda r: r.preference)[0].exchange.to_text().rstrip('.'))"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    fallbacks = {
        'gmail.com': 'gmail-smtp-in.l.google.com',
        'googlemail.com': 'gmail-smtp-in.l.google.com',
        'yahoo.fr': 'mta5.am0.yahoodns.net',
        'yahoo.com': 'mta5.am0.yahoodns.net',
        'outlook.com': 'outlook-com.olc.protection.outlook.com',
        'hotmail.com': 'outlook-com.olc.protection.outlook.com',
    }
    return fallbacks.get(domain.lower())


def _send_direct_mx(to_email, msg_obj, from_email):
    """Livraison directe au serveur MX du destinataire sur port 25."""
    domain = to_email.split('@')[-1]
    mx_host = _get_mx_host(domain)
    if not mx_host:
        print(f"⚠️ MX introuvable pour {domain}")
        return False
    print(f"📡 Livraison directe → {mx_host}:25")
    try:
        with smtplib.SMTP(mx_host, 25, timeout=15) as s:
            s.ehlo('unchk.sn')
            try:
                s.starttls()
                s.ehlo('unchk.sn')
            except Exception:
                pass
            result = s.sendmail(from_email, [to_email], msg_obj.as_string())
            print(f"✅ Livraison directe OK à {to_email} (résultat: {result})")
            return True
    except Exception as e:
        print(f"❌ Livraison directe échouée pour {to_email}: {e}")
        return False


def send_email(to_email, subject, html_body, attachments=None):
    """Envoyer un email via SMTP université (smx7.unchk.sn), fallback livraison MX directe."""
    cfg = _smtp_config()

    from email.utils import formatdate, make_msgid
    from email.header import Header
    msg = MIMEMultipart('alternative')
    try:
        cfg['from_name'].encode('ascii')
        from_header = f"{cfg['from_name']} <{cfg['from_email']}>"
    except UnicodeEncodeError:
        from_header = f"{Header(cfg['from_name'], 'utf-8').encode()} <{cfg['from_email']}>"
    msg['From'] = from_header
    msg['To'] = to_email
    msg['Subject'] = subject
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='unchk.sn')
    msg.attach(MIMEText(html_body, 'html', 'utf-8'))

    if attachments:
        for attachment in attachments:
            try:
                with open(attachment['path'], 'rb') as f:
                    part = MIMEBase('application', 'octet-stream')
                    part.set_payload(f.read())
                    encoders.encode_base64(part)
                    part.add_header('Content-Disposition',
                                   f"attachment; filename= {attachment['filename']}")
                    msg.attach(part)
            except Exception as attach_error:
                print(f"⚠️ Erreur pièce jointe {attachment['filename']}: {attach_error}")

    # Tentative 1 : SMTP université (smx7.unchk.sn port 587 STARTTLS)
    if cfg['username'] and cfg['password']:
        try:
            with smtplib.SMTP(cfg['server'], cfg['port'], timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(cfg['username'], cfg['password'])
                server.send_message(msg)
            print(f"✅ Email envoyé à {to_email} (via {cfg['server']})")
            return True
        except (ConnectionResetError, OSError, smtplib.SMTPServerDisconnected) as conn_err:
            print(f"⚠️ SMTP {cfg['server']} inaccessible ({conn_err}) → basculement livraison directe")
        except smtplib.SMTPException as smtp_error:
            print(f"❌ Erreur SMTP envoi email à {to_email}: {smtp_error}")
            return False
        except Exception as e:
            print(f"⚠️ Erreur SMTP ({e}) → basculement livraison directe")

    # Tentative 2 : livraison directe au serveur MX du destinataire (port 25)
    # Utilise @unchk.sn comme expéditeur — son SPF couvre l'IP du serveur (102.36.138.0/23)
    # Un from @gmail.com serait rejeté car notre IP n'est pas dans le SPF de gmail.com
    direct_from = 'noreply@unchk.sn'
    # Reconstruire le message avec le bon expéditeur pour SPF
    from email.utils import formatdate, make_msgid
    from email.header import Header
    msg2 = MIMEMultipart('alternative')
    try:
        cfg['from_name'].encode('ascii')
        msg2['From'] = f"{cfg['from_name']} <{direct_from}>"
    except UnicodeEncodeError:
        msg2['From'] = f"{Header(cfg['from_name'], 'utf-8').encode()} <{direct_from}>"
    msg2['To'] = to_email
    msg2['Subject'] = subject
    msg2['Date'] = formatdate(localtime=True)
    msg2['Message-ID'] = make_msgid(domain='unchk.sn')
    msg2.attach(MIMEText(html_body, 'html', 'utf-8'))
    return _send_direct_mx(to_email, msg2, direct_from)

def send_account_created_email(user_email, user_name, role, temp_password=None):
    """Email de création de compte"""
    subject = "🎓 Votre compte CEI a été créé — Identifiants de connexion"

    smtp_cfg = _smtp_config()
    app_url = smtp_cfg['app_url']

    role_config = {
        'student': {
            'label': 'Étudiant',
            'color': '#059669',
            'bg': '#ecfdf5',
            'border': '#a7f3d0',
            'icon': '🎓',
            'guide_url': f'{app_url}/guide-etudiant',
            'guide_label': 'Guide Étudiant',
            'description': 'Vous pouvez désormais accéder à vos examens en ligne, soumettre vos copies et consulter vos résultats.',
        },
        'professor': {
            'label': 'Enseignant',
            'color': '#2563eb',
            'bg': '#eff6ff',
            'border': '#bfdbfe',
            'icon': '📚',
            'guide_url': f'{app_url}/guide-enseignant',
            'guide_label': 'Guide Enseignant',
            'description': "Vous pouvez créer des examens, surveiller les sessions en temps réel, corriger les copies avec l'IA et publier les notes.",
        },
        'surveillant': {
            'label': 'Surveillant',
            'color': '#d97706',
            'bg': '#fffbeb',
            'border': '#fcd34d',
            'icon': '👁️',
            'guide_url': f'{app_url}/guide-surveillant',
            'guide_label': 'Guide Surveillant',
            'description': "Vous serez affecté à des examens par les enseignants. Vous surveillerez un groupe d'étudiants qui vous sera assigné et pourrez intervenir en temps réel.",
        },
        'admin': {
            'label': 'Administrateur',
            'color': '#7c3aed',
            'bg': '#f5f3ff',
            'border': '#c4b5fd',
            'icon': '⚙️',
            'guide_url': f'{app_url}/app',
            'guide_label': "Accéder à l'interface",
            'description': "Vous disposez d'un accès complet à la plateforme : gestion des utilisateurs, des examens et des statistiques globales.",
        },
    }

    cfg = role_config.get(role.lower(), role_config['student'])

    html_body = f"""
    <html>
    <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;background:#f8fafc;margin:0;padding:0;">
        <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

            <!-- Header -->
            <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);border-radius:12px 12px 0 0;padding:32px;text-align:center;">
                <div style="font-size:48px;margin-bottom:12px;">{cfg['icon']}</div>
                <h1 style="color:white;font-size:22px;font-weight:800;margin:0 0 8px;">Centre d'Examen Intelligent</h1>
                <p style="color:rgba(255,255,255,.85);font-size:14px;margin:0;">Votre compte a été créé avec succès</p>
            </div>

            <!-- Body -->
            <div style="background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:32px;">

                <!-- Role badge -->
                <div style="display:inline-block;background:{cfg['bg']};border:1px solid {cfg['border']};color:{cfg['color']};padding:6px 16px;border-radius:99px;font-size:13px;font-weight:700;margin-bottom:20px;">
                    {cfg['icon']} Rôle : {cfg['label']}
                </div>

                <p style="font-size:16px;color:#0f172a;margin:0 0 12px;">Bonjour <strong>{user_name}</strong>,</p>
                <p style="font-size:14px;color:#475569;margin:0 0 24px;">{cfg['description']}</p>

                <!-- Credentials box -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid {cfg['color']};border-radius:8px;padding:20px;margin-bottom:24px;">
                    <p style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:0 0 14px;">Vos identifiants de connexion</p>
                    <p style="margin:6px 0;font-size:14px;color:#0f172a;"><span style="color:#64748b;">📧 Email :</span> <strong>{user_email}</strong></p>
                    {f'<p style="margin:6px 0;font-size:14px;color:#0f172a;"><span style="color:#64748b;">🔒 Mot de passe :</span> <strong style="font-family:monospace;background:#f1f5f9;padding:2px 8px;border-radius:4px;">{temp_password}</strong></p>' if temp_password else ''}
                </div>

                <!-- CTA buttons -->
                <div style="text-align:center;margin-bottom:24px;">
                    <a href="{app_url}/app"
                       style="display:inline-block;padding:13px 28px;background:{cfg['color']};color:white;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;margin-bottom:12px;">
                        Se connecter à la plateforme
                    </a>
                    <br>
                    <a href="{cfg['guide_url']}"
                       style="display:inline-block;margin-top:8px;font-size:13px;color:{cfg['color']};text-decoration:underline;">
                        📖 Consulter le {cfg['guide_label']}
                    </a>
                </div>

                <!-- Security note -->
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;font-size:12px;color:#92400e;">
                    ⚠️ Pour votre sécurité, changez votre mot de passe dès votre première connexion via les paramètres de votre profil.
                </div>

                <p style="color:#94a3b8;font-size:11px;margin-top:24px;text-align:center;line-height:1.7;">
                    © 2026 CEI — RTN – Réseaux et Techniques Numériques<br>
                    Liberté 2, derrière immeuble BICIS, Jet d'eau – Dakar – Sénégal<br>
                    (+221) 77 662 76 94 &nbsp;·&nbsp;
                    <a href="mailto:entreprisertn221@gmail.com" style="color:#94a3b8;">entreprisertn221@gmail.com</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    """

    return send_email(user_email, subject, html_body)

def send_paper_corrected_email(student_email, student_name, subject_title, score, paper_id, attachments=None):
    """Email de copie corrigée - Amélioré : Avec attachments"""
    subject = f"✅ Votre copie ({subject_title}) a été corrigée"

    app_url = _smtp_config()['app_url']
    score_color = "#10b981" if score >= 10 else "#ef4444"

    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #2563eb;">📝 Copie Corrigée</h2>
            <p>Bonjour <strong>{student_name}</strong>,</p>
            <p>Votre copie pour le sujet <strong>{subject_title}</strong> a été corrigée.</p>

            <div style="background: #f8fafc; padding: 20px; border-radius: 6px; margin: 20px 0; text-align: center;">
                <p style="font-size: 18px; margin: 0;">Votre note:</p>
                <p style="font-size: 36px; font-weight: bold; color: {score_color}; margin: 10px 0;">{score}/20</p>
            </div>

            <p>Vous pouvez consulter le détail dans l'application. Si vous souhaitez contester, vous avez 7 jours à compter de la correction.</p>

            <p><a href="{app_url}/app" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">Voir ma copie</a></p>

            <p style="color:#94a3b8;font-size:11px;margin-top:30px;text-align:center;line-height:1.7;">
                © 2026 CEI — RTN – Réseaux et Techniques Numériques<br>
                Liberté 2, derrière immeuble BICIS, Jet d'eau – Dakar – Sénégal<br>
                (+221) 77 662 76 94 &nbsp;·&nbsp;
                <a href="mailto:entreprisertn221@gmail.com" style="color:#94a3b8;">entreprisertn221@gmail.com</a>
            </p>
        </div>
    </body>
    </html>
    """

    return send_email(student_email, subject, html_body, attachments)

# ============================================================================
# VALIDATION DE FICHIERS
# ============================================================================

ALLOWED_EXTENSIONS = {'pdf', 'docx', 'doc', 'txt'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ============================================================================
# GÉNÉRATION DE STATISTIQUES (conservé)
# ============================================================================

def generate_pdf_report(data, output_path):
    """Générer un rapport PDF (pour statistiques)"""
    # Implémentation existante...
    pass

def generate_statistics_chart(data):
    """Générer un graphique de statistiques"""
    # Implémentation existante...
    pass

# ============================================================================
# AMÉLIORATION MATCHING NOMS ÉTUDIANTS
# ============================================================================

def normalize_name(name):
    """Normaliser un nom pour comparaison
    - Minuscules
    - Suppression accents
    - Suppression espaces multiples
    """
    if not name:
        return ""

    # Minuscules
    name = name.lower().strip()

    # Supprimer accents
    name = ''.join(
        c for c in unicodedata.normalize('NFD', name)
        if unicodedata.category(c) != 'Mn'
    )

    # Espaces multiples -> un seul
    name = ' '.join(name.split())

    return name

def match_student_by_name(extracted_name, session):
    """Trouver un étudiant par nom avec matching intelligent

    Gère :
    - Ordre inversé (Prénom Nom vs Nom Prénom)
    - Casse différente
    - Accents
    - Espaces

    Args:
        extracted_name: Nom extrait de la copie
        session: Session SQLAlchemy

    Returns:
        User object ou None
    """
    from models import User, UserRole

    if not extracted_name:
        return None

    # Normaliser le nom extrait
    norm_extracted = normalize_name(extracted_name)

    # Récupérer tous les étudiants
    students = session.query(User).filter_by(role=UserRole.STUDENT).all()

    for student in students:
        norm_student = normalize_name(student.full_name)

        # 1. Matching exact
        if norm_extracted == norm_student:
            print(f" ✅ Match exact: {student.full_name}")
            return student

        # 2. Matching inversé (Prénom Nom vs Nom Prénom)
        parts_extracted = norm_extracted.split()
        parts_student = norm_student.split()

        if len(parts_extracted) >= 2 and len(parts_student) >= 2:
            # Inverser et comparer
            reversed_extracted = ' '.join(reversed(parts_extracted))
            if reversed_extracted == norm_student:
                print(f" ✅ Match inversé: {student.full_name}")
                return student

            # 3. Nom de famille + prénom partiel
            # Ex: "Serge Bounguele" match "BOUNGUELE Serge"
            if parts_extracted[-1] == parts_student[0] or parts_extracted[-1] == parts_student[-1]:
                if parts_extracted[0] in parts_student or parts_student[0] in parts_extracted:
                    print(f"Match partiel: {student.full_name}")
                    return student

            # 4. Les deux parties du nom sont présentes (ordre peu importe)
            if all(part in parts_student for part in parts_extracted[:2]):
                print(f"Match multi-partie: {student.full_name}")
                return student

    return None

def find_or_create_student(student_name, extracted_name, session):
    """Trouver ou créer un étudiant avec matching intelligent

    Args:
        student_name: Nom fourni manuellement (peut être None)
        extracted_name: Nom extrait de la copie
        session: Session SQLAlchemy

    Returns:
        User object
    """
    from models import User, UserRole
    from flask_bcrypt import Bcrypt

    bcrypt = Bcrypt()

    # Essayer de matcher avec le nom fourni
    if student_name:
        student = match_student_by_name(student_name, session)
        if student:
            return student

    # Essayer de matcher avec le nom extrait
    if extracted_name:
        student = match_student_by_name(extracted_name, session)
        if student:
            return student

    # Si aucun match, créer un étudiant temporaire
    name_to_use = student_name or extracted_name or "Étudiant Inconnu"
    temp_email = f"{normalize_name(name_to_use).replace(' ', '.')}@temp.edu"
    temp_password = bcrypt.generate_password_hash('TempPassword123').decode('utf-8')

    student = User(
        email=temp_email,
        password_hash=temp_password,
        full_name=name_to_use,
        role=UserRole.STUDENT
    )

    session.add(student)
    session.flush()

    print(f"Étudiant créé temporairement: {student.full_name} ({student.email})")
    print(f"Associez-le à un compte réel via l'interface admin")

    return student


def send_password_reset_email(user_email, user_name, reset_link):
    """Email de réinitialisation de mot de passe — token valide 1 heure."""
    smtp_cfg = _smtp_config()
    subject = "Réinitialisation de votre mot de passe CEI"
    html_body = f"""
    <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f1f5f9;margin:0;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:32px 36px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">🔐</div>
            <h1 style="color:white;margin:0;font-size:22px;font-weight:700;">Réinitialisation du mot de passe</h1>
            <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px;">Centre d'Examen Intelligent</p>
        </div>
        <div style="padding:32px 36px;">
            <p style="color:#1e293b;font-size:15px;margin:0 0 16px;">Bonjour <strong>{user_name}</strong>,</p>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
                Nous avons reçu une demande de réinitialisation du mot de passe de votre compte CEI.<br>
                Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe.
            </p>
            <div style="text-align:center;margin:28px 0;">
                <a href="{reset_link}" style="display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">
                    Réinitialiser mon mot de passe
                </a>
            </div>
            <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin-top:8px;">
                <p style="margin:0;font-size:13px;color:#92400e;">
                    <strong>⚠️ Ce lien expire dans 1 heure.</strong><br>
                    Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe reste inchangé.
                </p>
            </div>
        </div>
        <div style="background:#f8fafc;padding:16px 36px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
                CEI — Centre d'Examen Intelligent &nbsp;|&nbsp; {smtp_cfg.get('app_url','https://cei.unchk.sn')}
            </p>
        </div>
    </div>
    </body></html>
    """
    return send_email(user_email, subject, html_body)


def generate_transcript_pdf(transcript_data, output_path):
    """Générer un relevé de notes en PDF
    transcript_data = {
        'student_name', 'student_email', 'semester_name', 'formation_name',
        'gpa', 'total_credits', 'obtained_credits', 'papers', 'generated_at'
    }
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
    from datetime import datetime
    
    doc = SimpleDocTemplate(output_path, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []
    
    # Style personnalisé
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=20,
        textColor=colors.HexColor('#2563eb'),
        spaceAfter=30,
        alignment=1  # Centré
    )
    
    header_style = ParagraphStyle(
        'CustomHeader',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#1e293b'),
        spaceAfter=12
    )
    
    # En-tête
    story.append(Paragraph("RELEVÉ DE NOTES", title_style))
    story.append(Spacer(1, 0.3*inch))
    
    # Informations étudiant
    info_data = [
        ['Étudiant:', transcript_data.get('student_name', 'N/A')],
        ['Email:', transcript_data.get('student_email', 'N/A')],
        ['Formation:', transcript_data.get('formation_name', 'N/A')],
        ['Semestre:', transcript_data.get('semester_name', 'N/A')],
        ['Date:', transcript_data.get('generated_at', datetime.now().strftime('%d/%m/%Y'))]
    ]
    
    info_table = Table(info_data, colWidths=[2*inch, 4*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1e293b')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, colors.HexColor('#f8fafc')])
    ]))
    
    story.append(info_table)
    story.append(Spacer(1, 0.4*inch))
    
    # Tableau des notes
    story.append(Paragraph("Détail des Notes", header_style))
    story.append(Spacer(1, 0.1*inch))
    
    papers = transcript_data.get('papers', [])
    if papers:
        notes_data = [['Code EC', 'Intitulé', 'Note/20', 'Coef']]
        
        for paper in papers:
            notes_data.append([
                paper.get('ec_code', 'N/A'),
                paper.get('ec_name', 'N/A')[:40],  # Tronquer si trop long
                str(paper.get('score', 0)),
                str(paper.get('coefficient', 1))
            ])
        
        notes_table = Table(notes_data, colWidths=[1.2*inch, 3*inch, 1*inch, 0.8*inch])
        notes_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2563eb')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (2, 0), (3, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#e2e8f0')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')])
        ]))
        
        story.append(notes_table)
    else:
        story.append(Paragraph("Aucune note disponible", styles['BodyText']))
    
    story.append(Spacer(1, 0.4*inch))
    
    # Résumé
    gpa = transcript_data.get('gpa', 0)
    gpa_color = colors.HexColor('#10b981') if gpa >= 10 else colors.HexColor('#ef4444')
    
    summary_data = [
        ['Moyenne Générale (GPA):', f"{gpa}/20"],
        ['Crédits Totaux:', str(transcript_data.get('total_credits', 0))],
        ['Crédits Obtenus:', str(transcript_data.get('obtained_credits', 0))],
        ['Décision:', 'VALIDÉ' if gpa >= 10 else 'NON VALIDÉ']
    ]
    
    summary_table = Table(summary_data, colWidths=[3*inch, 3*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1e293b')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 2, colors.HexColor('#2563eb')),
        ('TEXTCOLOR', (1, 0), (1, 0), gpa_color),
        ('TEXTCOLOR', (1, 3), (1, 3), gpa_color)
    ]))
    
    story.append(summary_table)
    
    # Footer
    story.append(Spacer(1, 0.5*inch))
    footer_style = ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#64748b'),
        alignment=1
    )
    story.append(Paragraph("Système de Notation Automatisé - Document officiel généré le " +
                          datetime.now().strftime('%d/%m/%Y à %H:%M'), footer_style))
    
    # Générer le PDF
    doc.build(story)
    return output_path