# Hébergement gratuit pour la démo, sans VPS

Les chiffres ci-dessous ont été relevés le 13 novembre 2026. Les offres gratuites changent souvent : les revérifier sur la page de tarifs de chaque service avant de s'engager.

## Combinaison recommandée

| Brique           | Service              | Offre gratuite                                                    | Limite à connaître                                                   |
| ---------------- | -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Frontend         | Cloudflare Pages     | Sites statiques, bande passante illimitée                         | Aucune pour une démo                                                 |
| API NestJS       | Render (Web Service) | 512 Mo de RAM, 0,1 CPU, 750 heures par mois                       | S'endort après 15 minutes sans trafic ; réveil en une minute environ |
| PostgreSQL       | Neon                 | 1 Go par projet, 100 heures de calcul par mois                    | Se met en veille après 5 minutes, réveil rapide                      |
| Redis            | Upstash              | 256 Mo, 500 000 commandes par mois                                | BullMQ consomme des commandes même au repos                          |
| Stockage         | Cloudflare R2        | 10 Go, pas de frais de sortie                                     | Carte bancaire demandée à l'inscription                              |
| Authentification | Supabase Auth        | Large quota d'utilisateurs actifs                                 | Projet mis en pause après une semaine sans activité                  |
| Worker vidéo     | Votre ordinateur     | Gratuit                                                           | Doit être allumé pendant la démo                                     |
| E-mails          | Resend ou Brevo      | Quelques centaines d'e-mails par jour                             | Domaine à vérifier                                                   |
| Erreurs          | Sentry               | Offre développeur                                                 | Un seul utilisateur                                                  |
| CI               | GitHub Actions       | Illimité sur dépôt public, 2 000 minutes par mois sur dépôt privé | —                                                                    |

## Les trois difficultés du « tout gratuit »

### 1. Le traitement vidéo

FFmpeg demande du processeur et de la mémoire. Les hébergeurs gratuits n'en donnent pas assez : 0,1 CPU chez Render ne permet pas d'encoder une vidéo dans un délai raisonnable.

Solution retenue : le worker vidéo n'a besoin d'aucune connexion entrante. Il lit ses tâches dans Redis et envoie ses résultats vers le stockage. Il peut donc tourner sur votre ordinateur pendant la démo, pendant que le reste est en ligne. Pour une démo fluide, se limiter à des vidéos courtes en 720p.

Autres pistes :

- **Google Cloud Run** : offre gratuite mensuelle permanente, adaptée à des tâches FFmpeg ponctuelles. Carte bancaire obligatoire.
- **Oracle Cloud Always Free** : machines ARM gratuites, mais c'est un VPS à administrer, avec carte bancaire et disponibilité aléatoire.
- **Hugging Face Spaces** : 2 vCPU et 16 Go annoncés gratuits, mais la création de Spaces Docker semble réservée aux comptes payants depuis 2026. À ne pas retenir sans vérification.

### 2. Les workers en arrière-plan

Chez Render, seuls les services web sont gratuits ; les « background workers » sont payants. Pour la démo, les workers légers (IA texte, publication, planification) tourneront dans le même processus que l'API, activés par une variable d'environnement. En production, ils seront séparés, comme le prévoit le cahier des charges.

### 3. La mise en veille

Une API endormie ne déclenche aucune publication programmée. Un service de ping gratuit (cron-job.org ou UptimeRobot) qui appelle `/api/v1/health` toutes les dix minutes la garde éveillée. Les 750 heures mensuelles de Render couvrent un service allumé en continu.

Pour Redis, BullMQ interroge la file en permanence : plusieurs workers inactifs peuvent épuiser les 500 000 commandes mensuelles d'Upstash. Il faudra espacer les interrogations et mesurer la consommation dès la Phase 3.

## IA : offres gratuites utilisables pour la démo

| Besoin        | Fournisseur                   | Remarque                                                                       |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| Transcription | Groq (Whisper large v3)       | Environ 2 000 requêtes et 8 heures d'audio par jour, fichiers de 25 Mo au plus |
| Texte         | Google Gemini, Groq, Mistral  | Offres gratuites limitées en débit                                             |
| Image         | Cloudflare Workers AI, Gemini | Quota quotidien réduit                                                         |
| Voix          | ElevenLabs, Gemini            | Quelques minutes par mois                                                      |

Ces offres servent à démontrer, pas à vendre : leurs conditions limitent souvent l'usage commercial, et certains fournisseurs réutilisent les données envoyées gratuitement.

## Montrer la démo sans rien déployer

Un tunnel Cloudflare (`cloudflared tunnel --url http://localhost:5173`) donne une URL HTTPS publique vers votre ordinateur, gratuitement et sans compte. C'est le moyen le plus rapide de faire tester l'application à quelqu'un, et il fournit aussi l'URL HTTPS exigée par les callbacks OAuth.

## Ce qui ne sera pas gratuit

- Un nom de domaine, nécessaire pour les e-mails et la validation des applications Meta et TikTok.
- L'API de X, payante.
- L'IA au-delà de la démo.
- Une vraie production : l'API sans mise en veille coûte environ 7 dollars par mois chez Render, et le traitement vidéo demandera une machine dédiée.

## Sources

- [Render : plateformes avec une offre gratuite réelle](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)
- [Render : documentation](https://render.com/docs/llms-full.txt)
- [Neon : limites de l'offre gratuite](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Upstash : tarifs Redis](https://upstash.com/blog/redis-cloud-pricing-in-2026-plans-costs-and-real-examples)
- [Hugging Face : présentation des Spaces](https://huggingface.co/docs/hub/en/spaces-overview)
- [Hugging Face : discussion sur les Spaces Docker payants](https://discuss.huggingface.co/t/docker-sdk-now-marked-as-paid-when-creating-a-new-space/177580/5)
- [Groq : comparatif des API Whisper gratuites](https://spokenly.app/blog/free-speech-to-text-apis)
