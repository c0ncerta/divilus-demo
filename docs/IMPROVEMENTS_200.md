# DiavloCord - Backlog de 200 mejoras

## Estado
- `HECHO` = aplicado en este ciclo.
- `PENDIENTE` = priorizado para siguiente tanda.

1. HECHO - Conectar bot??n de campana del header a bandeja de menciones.
2. HECHO - Conectar bot??n de pin del header a vista de detalles.
3. HECHO - Conectar bot??n de miembros del header a vista de miembros.
4. HECHO - Limpiar `selectedUserId` al abrir detalles/miembros para evitar estado atascado.
5. HECHO - A??adir badge num??rico de no le??dos en campana superior.
6. HECHO - A??adir atajo `Alt+1` para abrir/cerrar bandeja de menciones.
7. HECHO - A??adir atajo `Alt+2` para abrir detalles del canal.
8. HECHO - A??adir atajo `Alt+3` para abrir lista de miembros.
9. HECHO - A??adir `aria-label` a botones cr??ticos del header.
10. HECHO - A??adir `title` con atajos visibles para feedback UX.
11. HECHO - Reducir tama??o m?ximo de mensajes persistidos por canal.
12. HECHO - Reducir tama??o m?ximo de mensajes persistidos por hilo.
13. HECHO - Reducir tama??o m?ximo de entradas de auditor??a persistidas.
14. HECHO - Reducir longitud m?xima de contenido persistido.
15. HECHO - Limitar longitud m?xima de URLs persistidas.
16. HECHO - Sanitizar adjuntos antes de persistir.
17. HECHO - Sanitizar avatar/banner de usuario al persistir.
18. HECHO - Sanitizar icon/banner de servidor al persistir.
19. HECHO - Limitar cantidad de servidores persistidos.
20. HECHO - Limitar sesiones de dispositivo persistidas por usuario.
21. HECHO - Evitar persistir snapshot pesado cuando backend est? activo.
22. HECHO - Forzar `presences` a vac??o en persistencia local.
23. HECHO - Robustecer fallback de quota en storage persistente.
24. HECHO - A??adir `src/app/icon.ico` para evitar 404 de favicon.
25. PENDIENTE - A??adir panel de diagn??stico de latencia cliente-servidor.
26. PENDIENTE - A??adir detector de ca??das de socket con reconexi??n visual.
27. PENDIENTE - A??adir cola local de mensajes offline con reenv??o al reconectar.
28. PENDIENTE - A??adir control de duplicados de mensajes por `clientNonce`.
29. PENDIENTE - A??adir idempotencia fuerte en env??o de adjuntos.
30. PENDIENTE - A??adir protecci??n contra race conditions al cambiar de canal.
31. PENDIENTE - A??adir guardado incremental de estado por m??dulos.
32. PENDIENTE - A??adir expiraci??n autom?tica de cach?? de medios locales.
33. PENDIENTE - A??adir compresi??n opcional de payload de estado.
34. PENDIENTE - A??adir reintento exponencial configurable en fetch cr??ticos.
35. PENDIENTE - A??adir retry budget global para evitar loops infinitos.
36. PENDIENTE - A??adir timeout de red centralizado por endpoint.
37. PENDIENTE - A??adir monitor de memoria del cliente.
38. PENDIENTE - A??adir limpieza de listeners hu??rfanos al desmontar vistas.
39. PENDIENTE - A??adir deduplicaci??n de toasts id??nticos en ventana temporal.
40. PENDIENTE - A??adir modo degradado cuando no hay backend.
41. PENDIENTE - A??adir validaci??n fuerte de `DATABASE_URL` en boot backend.
42. PENDIENTE - A??adir validaci??n fuerte de `DIRECT_URL` en boot backend.
43. PENDIENTE - A??adir comando de preflight para DB antes de deploy.
44. PENDIENTE - A??adir health check `/health/ws` para estado de sockets.
45. PENDIENTE - A??adir health check `/health/storage` para media pipeline.
46. PENDIENTE - A??adir logs estructurados JSON en backend.
47. PENDIENTE - A??adir correlaci??n por `request-id` entre frontend/backend.
48. PENDIENTE - A??adir m??tricas Prometheus m??nimas.
49. PENDIENTE - A??adir l??mites por IP para login/register.
50. PENDIENTE - A??adir l??mites por usuario para env??o de mensajes.
51. PENDIENTE - A??adir auditor??a de cambios de roles.
52. PENDIENTE - A??adir auditor??a de borrado de mensajes.
53. PENDIENTE - A??adir auditor??a de invitaciones creadas/revocadas.
54. PENDIENTE - A??adir paginaci??n de auditor??a por cursor.
55. PENDIENTE - A??adir endpoint de exportaci??n de auditor??a CSV.
56. PENDIENTE - A??adir rotaci??n de claves JWT documentada.
57. PENDIENTE - A??adir invalidaci??n manual de sesiones activas.
58. PENDIENTE - A??adir expiraci??n configurable de sesiones.
59. PENDIENTE - A??adir verificaci??n de email opcional.
60. PENDIENTE - A??adir recuperaci??n de cuenta con doble factor opcional.
61. PENDIENTE - A??adir edici??n de mensajes con historial.
62. PENDIENTE - A??adir borrado en lote por selecci??n m?oltiple.
63. PENDIENTE - A??adir anclado r?pido por hover action.
64. PENDIENTE - A??adir quote-reply visual m?s rico.
65. PENDIENTE - A??adir vista de hilo desacoplada tipo panel lateral.
66. PENDIENTE - A??adir unread separator din?mico por canal.
67. PENDIENTE - A??adir jump-to-first-unread.
68. PENDIENTE - A??adir b?osqueda sem?ntica b?sica por trigramas.
69. PENDIENTE - A??adir filtros de b?osqueda por rango de fecha.
70. PENDIENTE - A??adir filtros de b?osqueda por tipo de archivo.
71. PENDIENTE - A??adir filtros de b?osqueda por menciones.
72. PENDIENTE - A??adir preview enriquecida de enlaces.
73. PENDIENTE - A??adir open graph cache local.
74. PENDIENTE - A??adir colapsado autom?tico de mensajes largos.
75. PENDIENTE - A??adir markdown b?sico seguro.
76. PENDIENTE - A??adir bloques de c??digo con resaltado.
77. PENDIENTE - A??adir tabla de atajos de teclado en UI.
78. PENDIENTE - A??adir reacci??n r?pida por doble click.
79. PENDIENTE - A??adir reacci??n reciente favorita.
80. PENDIENTE - A??adir reacci??n personalizada por servidor.
81. PENDIENTE - A??adir subida chunked de v??deos grandes.
82. PENDIENTE - A??adir barra de progreso real por archivo.
83. PENDIENTE - A??adir cancelaci??n de subida por archivo.
84. PENDIENTE - A??adir reintento de subida fallida.
85. PENDIENTE - A??adir cola de transcodificaci??n server-side.
86. PENDIENTE - A??adir thumbnail autom?tica de v??deo.
87. PENDIENTE - A??adir metadata visible (duraci??n, peso, codec).
88. PENDIENTE - A??adir l??mite din?mico por tipo de cuenta.
89. PENDIENTE - A??adir compresi??n imagen adaptativa por resoluci??n.
90. PENDIENTE - A??adir compresi??n HEIC/HEIF a webp/jpeg.
91. PENDIENTE - A??adir detecci??n de contenido NSFW opcional.
92. PENDIENTE - A??adir visor de imagen con zoom por rueda.
93. PENDIENTE - A??adir visor de v??deo con frame stepping.
94. PENDIENTE - A??adir descarga con nombre original fiable.
95. PENDIENTE - A??adir bot??n "guardar como" en visor multimedia.
96. PENDIENTE - A??adir copiar enlace multimedia al portapapeles.
97. PENDIENTE - A??adir galer??a de medios por canal con virtualizaci??n.
98. PENDIENTE - A??adir carga diferida de previews multimedia.
99. PENDIENTE - A??adir fallback cuando FFmpeg no est? disponible.
100. PENDIENTE - A??adir panel de estado FFmpeg en ajustes.
101. PENDIENTE - A??adir reconexi??n autom?tica de voz con backoff.
102. PENDIENTE - A??adir indicador de jitter/packet loss.
103. PENDIENTE - A??adir selecci??n avanzada de bitrate.
104. PENDIENTE - A??adir supresi??n de ruido configurable.
105. PENDIENTE - A??adir cancelaci??n de eco configurable.
106. PENDIENTE - A??adir prueba de micr??fono integrada.
107. PENDIENTE - A??adir prueba de altavoces integrada.
108. PENDIENTE - A??adir calibraci??n de nivel autom?tico.
109. PENDIENTE - A??adir push-to-talk con tecla configurable.
110. PENDIENTE - A??adir overlay de speaking estable sin parpadeos.
111. PENDIENTE - A??adir hand raise en canales de voz.
112. PENDIENTE - A??adir stage mode ligero.
113. PENDIENTE - A??adir screen share con selector de calidad.
114. PENDIENTE - A??adir grabaci??n local opcional.
115. PENDIENTE - A??adir layout din?mico de videollamada.
116. PENDIENTE - A??adir spotlight de hablante activo.
117. PENDIENTE - A??adir control granular de permisos de c?mara.
118. PENDIENTE - A??adir control granular de permisos de micro.
119. PENDIENTE - A??adir bloqueo de auto-play en canales ocultos.
120. PENDIENTE - A??adir fallback de voz-only en red d??bil.
121. PENDIENTE - A??adir transici??n tipo genie m?s suave.
122. PENDIENTE - A??adir easing consistente para paneles.
123. PENDIENTE - A??adir animaci??n de apertura de popups por escala f??sica.
124. PENDIENTE - A??adir microinteracciones en hover de botones principales.
125. PENDIENTE - A??adir skeleton loaders en listas largas.
126. PENDIENTE - A??adir shimmer de carga en tarjetas.
127. PENDIENTE - A??adir glass presets globales por tema.
128. PENDIENTE - A??adir sistema de tokens de elevaci??n visual.
129. PENDIENTE - A??adir tokens de blur por capa.
130. PENDIENTE - A??adir tokens de color por contexto (danger/success/info).
131. PENDIENTE - A??adir animaciones reducidas para `prefers-reduced-motion`.
132. PENDIENTE - A??adir modo alto contraste.
133. PENDIENTE - A??adir modo dalt??nico.
134. PENDIENTE - A??adir personalizaci??n de densidad UI.
135. PENDIENTE - A??adir selector de tipograf??a del cliente.
136. PENDIENTE - A??adir editor de tema r?pido con preview.
137. PENDIENTE - A??adir animaciones de entrada de mensajes configurables.
138. PENDIENTE - A??adir animaci??n de salida al borrar mensajes.
139. PENDIENTE - A??adir sound design opcional por acciones clave.
140. PENDIENTE - A??adir vibration API opcional en mobile.
141. PENDIENTE - A??adir flujo completo de roles jer?rquicos drag-and-drop.
142. PENDIENTE - A??adir plantilla de permisos por tipo de canal.
143. PENDIENTE - A??adir permisos negativos expl??citos por miembro.
144. PENDIENTE - A??adir clonado de roles.
145. PENDIENTE - A??adir import/export de configuraci??n de roles.
146. PENDIENTE - A??adir asistente para configurar servidor nuevo.
147. PENDIENTE - A??adir onboarding de seguridad para due??os.
148. PENDIENTE - A??adir plantillas de AutoMod por idioma.
149. PENDIENTE - A??adir reglas regex con tester en vivo.
150. PENDIENTE - A??adir sandbox de prueba para AutoMod.
151. PENDIENTE - A??adir invitaciones con restricciones por rol.
152. PENDIENTE - A??adir invitaciones de un solo uso verificables.
153. PENDIENTE - A??adir expiraci??n visible en tarjetas de invitaci??n.
154. PENDIENTE - A??adir historial de expulsiones y baneos.
155. PENDIENTE - A??adir restauraci??n guiada de miembros expulsados.
156. PENDIENTE - A??adir motivo obligatorio en acciones de moderaci??n.
157. PENDIENTE - A??adir cooldown anti-spam por canal configurable.
158. PENDIENTE - A??adir canal de logs autom?tico configurable.
159. PENDIENTE - A??adir backups de configuraci??n del servidor.
160. PENDIENTE - A??adir restauraci??n de configuraci??n desde backup.
161. PENDIENTE - A??adir pesta??a de amigos estilo lista completa.
162. PENDIENTE - A??adir ordenado por actividad reciente en amigos.
163. PENDIENTE - A??adir sugerencias inteligentes de amistad.
164. PENDIENTE - A??adir etiquetas personalizadas de amigos.
165. PENDIENTE - A??adir notas privadas por usuario mejoradas.
166. PENDIENTE - A??adir solicitudes de amistad con mensajes opcionales.
167. PENDIENTE - A??adir bloqueo/silencio con granularidad por contexto.
168. PENDIENTE - A??adir categor??a "favoritos" en DMs.
169. PENDIENTE - A??adir carpetas de chats directos.
170. PENDIENTE - A??adir estado personalizado con expiraci??n.
171. PENDIENTE - A??adir presence enriquecida por juego/app.
172. PENDIENTE - A??adir panel "Activo ahora" propio de DiavloCord.
173. PENDIENTE - A??adir recomendaci??n de servidores por afinidad.
174. PENDIENTE - A??adir perfil de servidor expandible con bio/banner.
175. PENDIENTE - A??adir insignias din?micas por actividad.
176. PENDIENTE - A??adir historial de cambios de perfil.
177. PENDIENTE - A??adir vista p?oblica de perfil compartible.
178. PENDIENTE - A??adir sincronizaci??n de avatar/banner entre dispositivos.
179. PENDIENTE - A??adir panel de privacidad por contacto.
180. PENDIENTE - A??adir control anti acoso con filtros adaptativos.
181. PENDIENTE - A??adir suite de tests unitarios para store.
182. PENDIENTE - A??adir tests de integraci??n de socket.
183. PENDIENTE - A??adir tests E2E de login/chat/media.
184. PENDIENTE - A??adir tests visuales de regresi??n de UI.
185. PENDIENTE - A??adir CI pipeline con typecheck+build+tests.
186. PENDIENTE - A??adir pre-commit hooks para calidad.
187. PENDIENTE - A??adir reporte autom?tico de bundle size.
188. PENDIENTE - A??adir budget de performance y alertas.
189. PENDIENTE - A??adir source maps privados en producci??n.
190. PENDIENTE - A??adir tracking de errores frontend (Sentry o similar).
191. PENDIENTE - A??adir tracking de errores backend con agrupaci??n.
192. PENDIENTE - A??adir feature flags remotas.
193. PENDIENTE - A??adir despliegues canary.
194. PENDIENTE - A??adir rollback autom?tico ante fallo healthcheck.
195. PENDIENTE - A??adir documentaci??n de arquitectura actualizada.
196. PENDIENTE - A??adir playbook de incidentes.
197. PENDIENTE - A??adir gu??a de migraciones de base de datos.
198. PENDIENTE - A??adir panel interno de administraci??n.
199. PENDIENTE - A??adir CLI de mantenimiento de estado.
200. PENDIENTE - A??adir roadmap trimestral con milestones y KPIs.

