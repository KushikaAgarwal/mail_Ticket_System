// // // /**
// // //  * Agent Extension (BR-19 to BR-23), now with outbound calling.
// // //  *
// // //  * Registers a browser softphone (extension 1002 in the R&D Asterisk setup)
// // //  * via SIP.js. Handles two call directions:
// // //  *
// // //  *  - INBOUND: onInvite fires when a call rings in. Caller's number is
// // //  *    captured and POSTed to /api/calls/inbound so the screen-pop form
// // //  *    appears pre-filled (BR-20).
// // //  *
// // //  *  - OUTBOUND (new): the rep types a number/extension into the dial box
// // //  *    and clicks "Call". This builds a SIP.js `Inviter` (not `Invitation` —
// // //  *    that class is only for *receiving* a call) targeting
// // //  *    sip:<dialNumber>@ASTERISK_HOST and sends the INVITE ourselves.
// // //  *
// // //  * Both directions converge on the same screen-pop ticket form and the
// // //  * same POST /api/calls/:callId/create-ticket flow (BR-21) once a call is
// // //  * live — createTicketFromCall on the backend doesn't care which side
// // //  * originated the call, it just needs a callId + callerNumber.
// // //  *
// // //  * Swap ASTERISK_HOST/EXT/PASSWORD for your environment. In production this
// // //  * whole SIP.js block should sit behind a vendor-agnostic CTI Adapter
// // //  * interface per the BRD's Section 14.6, so swapping Asterisk for
// // //  * Twilio/another vendor doesn't touch this component's UI logic.
// // //  */
// // // import React, { useEffect, useRef, useState } from 'react';
// // // import { notifyInboundCall, createTicketFromCall } from './services/ticketApi';

// // // // ---- EDIT for your environment ----
// // // const ASTERISK_HOST = 'localhost';
// // // const EXT = '1002';
// // // const PASSWORD = 'changeme1002';
// // // // ------------------------------------

// // // type CallState = 'idle' | 'ringing' | 'calling' | 'in-call' | 'ended';
// // // type CallDirection = 'inbound' | 'outbound' | null;

// // // export default function AgentExtension() {
// // //   const [registerStatus, setRegisterStatus] = useState('Not registered');
// // //   const [callState, setCallState] = useState<CallState>('idle');
// // //   const [callDirection, setCallDirection] = useState<CallDirection>(null);
// // //   const [callId, setCallId] = useState<string | null>(null);
// // //   const [callerNumber, setCallerNumber] = useState<string | null>(null);
// // //   const [log, setLog] = useState<string[]>([]);

// // //   // Outbound dial box
// // //   const [dialNumber, setDialNumber] = useState('');
// // //   const [dialing, setDialing] = useState(false);

// // //   // Ticket form state (BR-21)
// // //   const [description, setDescription] = useState('');
// // //   const [category, setCategory] = useState('UNSPECIFIED');
// // //   const [urgency, setUrgency] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
// // //   const [submitting, setSubmitting] = useState(false);
// // //   const [submitResult, setSubmitResult] = useState<string | null>(null);

// // //   // Holds whichever session is currently active — an `Invitation` (we
// // //   // were called) or an `Inviter` (we placed the call). SIP.js exposes the
// // //   // same .accept()/.bye()/.stateChange surface on both once the dialog is
// // //   // established, but Inviter additionally needs .invite() to actually
// // //   // send the INVITE, which is why placeCall() below constructs one
// // //   // explicitly rather than reusing invitationRef for both directions.
// // //   const invitationRef = useRef<any>(null);
// // //   const audioRef = useRef<HTMLAudioElement>(null);

// // //   // React 18 StrictMode runs effects twice in dev (mount → cleanup →
// // //   // mount) to surface missing-cleanup bugs. A SIP UserAgent isn't safe to
// // //   // spin up twice in a row like that — the second registration races the
// // //   // first's teardown, leaving Zoiper connected to a session this
// // //   // component no longer holds a live reference to (Hang Up then only
// // //   // kills the orphaned first session, not the real one). This ref
// // //   // survives StrictMode's remount, so only the *second* (final) effect
// // //   // run actually creates the UserAgent — the first run's cleanup is a
// // //   // no-op instead of tearing down a real session.
// // //   const userAgentRef = useRef<any>(null);
// // //   // Keep the SIP.js `UserAgent` and `Inviter` *classes* (not instances)
// // //   // around too — placeCall() needs UserAgent.makeURI() and `new Inviter(...)`,
// // //   // and re-reading window.SIP from inside a button handler would be racy
// // //   // if the script tag loads late.
// // //   const sipClassesRef = useRef<{ UserAgent: any; Inviter: any } | null>(null);

// // //   function appendLog(msg: string) {
// // //     setLog((prev) => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
// // //   }

// // //   useEffect(() => {
// // //     if (userAgentRef.current) {
// // //       // Already set up (StrictMode's first pass, or a fast-refresh
// // //       // remount) — don't create a second competing session.
// // //       return;
// // //     }

// // //     // Loaded via index.html <script> tag (see integration notes) so it's
// // //     // available as window.SIP — dynamic import avoids a hard npm dependency
// // //     // for this R&D-stage component.
// // //     const SIP = (window as any).SIP;
// // //     if (!SIP) {
// // //       appendLog('SIP.js not found on window — check index.html script tag');
// // //       return;
// // //     }

// // //     const { UserAgent, Registerer, Inviter } = SIP;
// // //     sipClassesRef.current = { UserAgent, Inviter };

// // //     const uri = UserAgent.makeURI(`sip:${EXT}@${ASTERISK_HOST}`);

// // //     const userAgent = new UserAgent({
// // //       uri,
// // //       transportOptions: { server: `wss://${ASTERISK_HOST}:8089/ws` },
// // //       authorizationUsername: EXT,
// // //       authorizationPassword: PASSWORD,
// // //       delegate: {
// // //         onInvite(invitation: any) {
// // //           invitationRef.current = invitation;
// // //           const caller = invitation.remoteIdentity.uri.user;
// // //           const newCallId = invitation.request.callId;

// // //           setCallDirection('inbound');
// // //           setCallId(newCallId);
// // //           setCallerNumber(caller);
// // //           setCallState('ringing');
// // //           appendLog(`Incoming call from ${caller}`);

// // //           // BR-20: notify backend so the screen-pop has caller info ready
// // //           notifyInboundCall(newCallId, caller, EXT).catch((e) =>
// // //             appendLog(`notifyInboundCall failed: ${e.message}`)
// // //           );

// // //           // Redundant, more direct signal for "the far end hung up" — fires
// // //           // specifically on an incoming BYE, independent of the generic
// // //           // stateChange below. Belt-and-suspenders against races where a
// // //           // stale session (see StrictMode/HMR note in the component
// // //           // docblock) swallows the stateChange event.
// // //           invitation.delegate = {
// // //             ...invitation.delegate,
// // //             onBye: (bye: any) => {
// // //               appendLog('Remote party hung up');
// // //               setCallState('ended');
// // //               bye.accept?.();
// // //             },
// // //           };

// // //           invitation.stateChange.addListener((state: string) => {
// // //             appendLog(`[inbound] session state → ${state}`);
// // //             if (state === 'Established') {
// // //               setCallState('in-call');
// // //               attachRemoteAudio(invitation);
// // //             }
// // //             if (state === 'Terminated') {
// // //               setCallState('ended');
// // //               appendLog('Call ended');
// // //             }
// // //           });
// // //         },
// // //       },
// // //     });

// // //     userAgentRef.current = userAgent;

// // //     userAgent
// // //       .start()
// // //       .then(() => {
// // //         const registerer = new Registerer(userAgent);
// // //         return registerer.register();
// // //       })
// // //       .then(() => {
// // //         setRegisterStatus(`Registered as ${EXT}`);
// // //         appendLog('Registered successfully');
// // //       })
// // //       .catch((e: Error) => {
// // //         setRegisterStatus('Registration failed');
// // //         appendLog(`Registration failed: ${e.message}`);
// // //       });

// // //     // Deliberately no cleanup here. StrictMode's phantom
// // //     // mount→cleanup→mount cycle would otherwise call userAgent.stop()
// // //     // right after creating it, leaving the ref pointing at a dead
// // //     // connection that the guard above then refuses to replace (since
// // //     // the ref is already set).
// // //     //
// // //     // CAVEAT (this is what caused the "hangup from Zoiper doesn't update
// // //     // the UI" bug): this trick only distinguishes StrictMode's synchronous
// // //     // double-invoke from a real remount. It does NOT protect against Vite
// // //     // Fast Refresh, which replaces the whole module (and therefore the ref)
// // //     // on every save while developing — each save silently registers a new,
// // //     // orphaned UserAgent as extension 1002 alongside the old one, so a BYE
// // //     // from the far end can land on a session your current UI isn't
// // //     // listening to. During dev, prefer a full page reload over relying on
// // //     // HMR when testing live-call behavior. As a safety net for real tab
// // //     // closes/navigation, explicitly stop the agent so Asterisk drops the
// // //     // registration promptly instead of waiting out its expiry timer.
// // //     const handleUnload = () => {
// // //       userAgent.stop().catch(() => {});
// // //     };
// // //     window.addEventListener('beforeunload', handleUnload);
// // //   }, []);

// // //   // Shared between inbound accept() and outbound invite() — both end up
// // //   // with a peerConnection on the session once the dialog is established;
// // //   // this just wires its remote tracks into the <audio> element.
// // //   function attachRemoteAudio(session: any) {
// // //     const pc = session.sessionDescriptionHandler?.peerConnection;
// // //     if (!pc) return;
// // //     const remoteStream = new MediaStream();
// // //     pc.getReceivers().forEach((r: RTCRtpReceiver) => r.track && remoteStream.addTrack(r.track));
// // //     if (audioRef.current) audioRef.current.srcObject = remoteStream;
// // //   }

// // //   function answerCall() {
// // //     const invitation = invitationRef.current;
// // //     if (!invitation) return;
// // //     invitation
// // //       .accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } })
// // //       .then(() => {
// // //         setCallState('in-call');
// // //         appendLog('Call answered');
// // //         attachRemoteAudio(invitation);
// // //       })
// // //       .catch((e: Error) => appendLog(`Failed to answer: ${e.message}`));
// // //   }

// // //   /** Places an outbound call to whatever is in the dial box, using SIP.js's
// // //    *  `Inviter` — the class for calls *we* originate (mirror image of
// // //    *  `Invitation`, which onInvite hands us for calls we receive). Reuses
// // //    *  the same userAgentRef connection/registration; no separate
// // //    *  registration is needed to place a call. */
// // //   function placeCall() {
// // //     const target = dialNumber.trim();
// // //     if (!target) return;

// // //     const userAgent = userAgentRef.current;
// // //     const classes = sipClassesRef.current;
// // //     if (!userAgent || !classes) {
// // //       appendLog('Cannot place call — softphone is not registered yet');
// // //       return;
// // //     }
// // //     if (callState === 'ringing' || callState === 'in-call' || callState === 'calling') {
// // //       appendLog('Cannot place call — already on a call');
// // //       return;
// // //     }

// // //     const { UserAgent, Inviter } = classes;
// // //     const targetURI = UserAgent.makeURI(`sip:${target}@${ASTERISK_HOST}`);
// // //     if (!targetURI) {
// // //       appendLog(`Invalid number/extension: ${target}`);
// // //       return;
// // //     }

// // //     const inviter = new Inviter(userAgent, targetURI, {
// // //       sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
// // //     });
// // //     invitationRef.current = inviter;

// // //     // Outbound calls don't get a callId from an incoming INVITE — SIP.js
// // //     // assigns the Call-ID header itself once .invite() builds the
// // //     // request, so we read it back off the underlying request afterward.
// // //     // Until then, generate a client-side placeholder so callId is never
// // //     // null while callState === 'calling' (used to gate the ticket form).
// // //     const provisionalCallId = `outbound-${Date.now()}`;
// // //     setCallId(provisionalCallId);
// // //     setCallerNumber(target);
// // //     setCallDirection('outbound');
// // //     setCallState('calling');
// // //     setDialing(true);
// // //     appendLog(`Calling ${target}...`);

// // //     // Same redundant BYE signal as the inbound path — this is what was
// // //     // missing before: on the *outbound* leg we never wired up onBye, only
// // //     // stateChange, so a stale/duplicate session (see docblock note on
// // //     // StrictMode/HMR remounts piling up UserAgents) could silently eat the
// // //     // 'Terminated' transition and leave the UI stuck on "In call".
// // //     inviter.delegate = {
// // //       ...inviter.delegate,
// // //       onBye: (bye: any) => {
// // //         appendLog('Remote party hung up');
// // //         setCallState('ended');
// // //         bye.accept?.();
// // //       },
// // //     };

// // //     inviter.stateChange.addListener((state: string) => {
// // //       appendLog(`[outbound] session state → ${state}`);
// // //       if (state === 'Established') {
// // //         setCallState('in-call');
// // //         appendLog('Call connected');
// // //         attachRemoteAudio(inviter);
// // //         const realCallId = inviter.request?.callId;
// // //         if (realCallId) {
// // //           setCallId(realCallId);
// // //         }
// // //       }
// // //       if (state === 'Terminated') {
// // //         setCallState('ended');
// // //         appendLog('Call ended');
// // //       }
// // //     });

// // //     inviter
// // //       .invite()
// // //       .then(() => {
// // //         // INVITE sent — ringing on the far end. Real Call-ID is available
// // //         // as soon as the request is built, so pick it up here too in case
// // //         // Established fires before we'd otherwise read it.
// // //         const realCallId = inviter.request?.callId;
// // //         if (realCallId) setCallId(realCallId);
// // //         notifyInboundCall(realCallId || provisionalCallId, target, EXT).catch((e) =>
// // //           appendLog(`notifyInboundCall failed: ${e.message}`)
// // //         );
// // //       })
// // //       .catch((e: Error) => {
// // //         appendLog(`Failed to place call: ${e.message}`);
// // //         setCallState('ended');
// // //       })
// // //       .finally(() => setDialing(false));
// // //   }

// // //   function hangupCall() {
// // //     const session = invitationRef.current;
// // //     if (!session) return;
// // //     // `Inviter`/`Invitation` both expose .bye() once Established, but a
// // //     // call we're still dialing out (state 'calling', not yet answered)
// // //     // needs .cancel() instead — .bye() on an un-established session throws.
// // //     if (callState === 'calling') {
// // //       session.cancel().catch((e: Error) => appendLog(`Cancel failed: ${e.message}`));
// // //     } else {
// // //       session.bye().catch((e: Error) => appendLog(`Hangup failed: ${e.message}`));
// // //     }
// // //     setCallState('ended');
// // //   }

// // //   async function submitTicket(e: React.FormEvent) {
// // //     e.preventDefault();
// // //     if (!callId || !callerNumber) return;
// // //     setSubmitting(true);
// // //     setSubmitResult(null);
// // //     try {
// // //       const result = await createTicketFromCall(callId, {
// // //         callerNumber,
// // //         agentId: EXT,
// // //         description,
// // //         category,
// // //         urgency,
// // //       });
// // //       setSubmitResult(
// // //         result.skipped
// // //           ? `Already ticketed as ${result.processInstanceId}`
// // //           : `Ticket created: ${result.processInstanceId}`
// // //       );
// // //     } catch (err: any) {
// // //       setSubmitResult(`Error: ${err.message}`);
// // //     } finally {
// // //       setSubmitting(false);
// // //     }
// // //   }

// // //   const onACall = callState === 'ringing' || callState === 'calling' || callState === 'in-call';

// // //   return (
// // //     <div className="agent-extension" style={{ display: 'flex', gap: 24, padding: 24 }}>
// // //       <audio ref={audioRef} autoPlay />

// // //       {/* Softphone panel */}
// // //       <div style={{ flex: '0 0 280px' }}>
// // //         <h3>Softphone — Extension {EXT}</h3>
// // //         <div
// // //           style={{
// // //             padding: 10,
// // //             borderRadius: 6,
// // //             background: registerStatus.startsWith('Registered') ? '#d4edda' : '#f8d7da',
// // //             marginBottom: 12,
// // //           }}
// // //         >
// // //           {registerStatus}
// // //         </div>

// // //         {/* Outbound dial box — disabled while already on/placing a call */}
// // //         <div style={{ marginBottom: 16 }}>
// // //           <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
// // //             Dial number / extension
// // //           </label>
// // //           <div style={{ display: 'flex', gap: 8 }}>
// // //             <input
// // //               value={dialNumber}
// // //               onChange={(e) => setDialNumber(e.target.value)}
// // //               placeholder="e.g. 1001"
// // //               disabled={onACall || dialing}
// // //               onKeyDown={(e) => {
// // //                 if (e.key === 'Enter' && !onACall && !dialing && dialNumber.trim()) placeCall();
// // //               }}
// // //               style={{ flex: 1 }}
// // //             />
// // //             <button onClick={placeCall} disabled={onACall || dialing || !dialNumber.trim()}>
// // //               {dialing ? 'Calling…' : 'Call'}
// // //             </button>
// // //           </div>
// // //         </div>

// // //         {callState === 'ringing' && callDirection === 'inbound' && (
// // //           <div style={{ padding: 10, background: '#fff3cd', borderRadius: 6, marginBottom: 12 }}>
// // //             Incoming call from {callerNumber}
// // //             <div style={{ marginTop: 8 }}>
// // //               <button onClick={answerCall}>Answer</button>
// // //               <button onClick={hangupCall} style={{ marginLeft: 8 }}>
// // //                 Decline
// // //               </button>
// // //             </div>
// // //           </div>
// // //         )}

// // //         {callState === 'calling' && callDirection === 'outbound' && (
// // //           <div style={{ padding: 10, background: '#e2e3ff', borderRadius: 6, marginBottom: 12 }}>
// // //             Calling {callerNumber}…
// // //             <div style={{ marginTop: 8 }}>
// // //               <button onClick={hangupCall}>Cancel</button>
// // //             </div>
// // //           </div>
// // //         )}

// // //         {callState === 'in-call' && (
// // //           <div style={{ padding: 10, background: '#cce5ff', borderRadius: 6, marginBottom: 12 }}>
// // //             In call with {callerNumber} ({callDirection})
// // //             <div style={{ marginTop: 8 }}>
// // //               <button onClick={hangupCall}>Hang Up</button>
// // //             </div>
// // //           </div>
// // //         )}

// // //         <div style={{ fontSize: 12, color: '#555', background: '#fafafa', padding: 8, borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
// // //           {log.map((line, i) => (
// // //             <div key={i}>{line}</div>
// // //           ))}
// // //         </div>
// // //       </div>

// // //       {/* Screen-pop ticket form — BR-20, BR-21 (works for either direction) */}
// // //       <div style={{ flex: 1 }}>
// // //         <h3>Ticket</h3>
// // //         {!callerNumber ? (
// // //           <p style={{ color: '#888' }}>Waiting for an inbound call, or dial out to start one…</p>
// // //         ) : (
// // //           <form onSubmit={submitTicket} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
// // //             <label>
// // //               {callDirection === 'outbound' ? 'Called number' : 'Caller number'}
// // //               <input value={callerNumber} disabled style={{ display: 'block', width: '100%' }} />
// // //             </label>

// // //             <label>
// // //               Description
// // //               <textarea
// // //                 value={description}
// // //                 onChange={(e) => setDescription(e.target.value)}
// // //                 rows={4}
// // //                 style={{ display: 'block', width: '100%' }}
// // //                 required
// // //               />
// // //             </label>

// // //             <label>
// // //               Category
// // //               <input
// // //                 value={category}
// // //                 onChange={(e) => setCategory(e.target.value)}
// // //                 style={{ display: 'block', width: '100%' }}
// // //               />
// // //             </label>

// // //             <label>
// // //               Urgency
// // //               <select value={urgency} onChange={(e) => setUrgency(e.target.value as any)} style={{ display: 'block', width: '100%' }}>
// // //                 <option value="LOW">LOW</option>
// // //                 <option value="MEDIUM">MEDIUM</option>
// // //                 <option value="HIGH">HIGH</option>
// // //               </select>
// // //             </label>

// // //             <button type="submit" disabled={submitting}>
// // //               {submitting ? 'Creating…' : 'Create Ticket'}
// // //             </button>

// // //             {submitResult && <div>{submitResult}</div>}
// // //           </form>
// // //         )}
// // //       </div>
// // //     </div>
// // //   );
// // // }


// // /**
// //  * Agent Extension (BR-19 to BR-23), now with outbound calling.
// //  *
// //  * Registers a browser softphone (extension 1002 in the R&D Asterisk setup)
// //  * via SIP.js. Handles two call directions:
// //  *
// //  *  - INBOUND: onInvite fires when a call rings in. Caller's number is
// //  *    captured and POSTed to /api/calls/inbound so the screen-pop form
// //  *    appears pre-filled (BR-20).
// //  *
// //  *  - OUTBOUND (new): the rep types a number/extension into the dial box
// //  *    and clicks "Call". This builds a SIP.js `Inviter` (not `Invitation` —
// //  *    that class is only for *receiving* a call) targeting
// //  *    sip:<dialNumber>@ASTERISK_HOST and sends the INVITE ourselves.
// //  *
// //  * Both directions converge on the same screen-pop ticket form and the
// //  * same POST /api/calls/:callId/create-ticket flow (BR-21) once a call is
// //  * live — createTicketFromCall on the backend doesn't care which side
// //  * originated the call, it just needs a callId + callerNumber.
// //  *
// //  * Swap ASTERISK_HOST/EXT/PASSWORD for your environment. In production this
// //  * whole SIP.js block should sit behind a vendor-agnostic CTI Adapter
// //  * interface per the BRD's Section 14.6, so swapping Asterisk for
// //  * Twilio/another vendor doesn't touch this component's UI logic.
// //  */
// // import React, { useEffect, useRef, useState } from 'react';
// // import { notifyInboundCall, createTicketFromCall } from './services/ticketApi';

// // // ---- EDIT for your environment ----
// // const ASTERISK_HOST = 'localhost';
// // const EXT = '1002';
// // const PASSWORD = 'changeme1002';
// // // ------------------------------------

// // type CallState = 'idle' | 'ringing' | 'calling' | 'in-call' | 'ended';
// // type CallDirection = 'inbound' | 'outbound' | null;

// // export default function AgentExtension() {
// //   const [registerStatus, setRegisterStatus] = useState('Not registered');
// //   const [callState, setCallState] = useState<CallState>('idle');
// //   const [callDirection, setCallDirection] = useState<CallDirection>(null);
// //   const [callId, setCallId] = useState<string | null>(null);
// //   const [callerNumber, setCallerNumber] = useState<string | null>(null);
// //   const [log, setLog] = useState<string[]>([]);

// //   // Outbound dial box
// //   const [dialNumber, setDialNumber] = useState('');
// //   const [dialing, setDialing] = useState(false);

// //   // Ticket form state (BR-21)
// //   const [description, setDescription] = useState('');
// //   const [category, setCategory] = useState('UNSPECIFIED');
// //   const [urgency, setUrgency] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
// //   const [submitting, setSubmitting] = useState(false);
// //   const [submitResult, setSubmitResult] = useState<string | null>(null);

// //   // Holds whichever session is currently active — an `Invitation` (we
// //   // were called) or an `Inviter` (we placed the call). SIP.js exposes the
// //   // same .accept()/.bye()/.stateChange surface on both once the dialog is
// //   // established, but Inviter additionally needs .invite() to actually
// //   // send the INVITE, which is why placeCall() below constructs one
// //   // explicitly rather than reusing invitationRef for both directions.
// //   const invitationRef = useRef<any>(null);
// //   const audioRef = useRef<HTMLAudioElement>(null);

// //   // React 18 StrictMode runs effects twice in dev (mount → cleanup →
// //   // mount) to surface missing-cleanup bugs. A SIP UserAgent isn't safe to
// //   // spin up twice in a row like that — the second registration races the
// //   // first's teardown, leaving Zoiper connected to a session this
// //   // component no longer holds a live reference to (Hang Up then only
// //   // kills the orphaned first session, not the real one). This ref
// //   // survives StrictMode's remount, so only the *second* (final) effect
// //   // run actually creates the UserAgent — the first run's cleanup is a
// //   // no-op instead of tearing down a real session.
// //   const userAgentRef = useRef<any>(null);
// //   // Keep the SIP.js `UserAgent` and `Inviter` *classes* (not instances)
// //   // around too — placeCall() needs UserAgent.makeURI() and `new Inviter(...)`,
// //   // and re-reading window.SIP from inside a button handler would be racy
// //   // if the script tag loads late.
// //   const sipClassesRef = useRef<{ UserAgent: any; Inviter: any } | null>(null);

// //   function appendLog(msg: string) {
// //     setLog((prev) => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
// //   }

// //   useEffect(() => {
// //     if (userAgentRef.current) {
// //       // Already set up (StrictMode's first pass, or a fast-refresh
// //       // remount) — don't create a second competing session.
// //       return;
// //     }

// //     // Loaded via index.html <script> tag (see integration notes) so it's
// //     // available as window.SIP — dynamic import avoids a hard npm dependency
// //     // for this R&D-stage component.
// //     const SIP = (window as any).SIP;
// //     if (!SIP) {
// //       appendLog('SIP.js not found on window — check index.html script tag');
// //       return;
// //     }

// //     const { UserAgent, Registerer, Inviter } = SIP;
// //     sipClassesRef.current = { UserAgent, Inviter };

// //     const uri = UserAgent.makeURI(`sip:${EXT}@${ASTERISK_HOST}`);

// //     const userAgent = new UserAgent({
// //       uri,
// //       transportOptions: { server: `wss://${ASTERISK_HOST}:8089/ws` },
// //       authorizationUsername: EXT,
// //       authorizationPassword: PASSWORD,
// //       delegate: {
// //         onInvite(invitation: any) {
// //           invitationRef.current = invitation;
// //           const caller = invitation.remoteIdentity.uri.user;
// //           const newCallId = invitation.request.callId;

// //           setCallDirection('inbound');
// //           setCallId(newCallId);
// //           setCallerNumber(caller);
// //           setCallState('ringing');
// //           appendLog(`Incoming call from ${caller}`);

// //           // BR-20: notify backend so the screen-pop has caller info ready
// //           notifyInboundCall(newCallId, caller, EXT).catch((e) =>
// //             appendLog(`notifyInboundCall failed: ${e.message}`)
// //           );

// //           // Redundant, more direct signal for "the far end hung up" — fires
// //           // specifically on an incoming BYE, independent of the generic
// //           // stateChange below. Belt-and-suspenders against races where a
// //           // stale session (see StrictMode/HMR note in the component
// //           // docblock) swallows the stateChange event.
// //           invitation.delegate = {
// //             ...invitation.delegate,
// //             onBye: (bye: any) => {
// //               appendLog('Remote party hung up');
// //               setCallState('ended');
// //               bye.accept?.();
// //             },
// //           };

// //           invitation.stateChange.addListener((state: string) => {
// //             appendLog(`[inbound] session state → ${state}`);
// //             if (state === 'Established') {
// //               setCallState('in-call');
// //               attachRemoteAudio(invitation);
// //             }
// //             if (state === 'Terminated') {
// //               setCallState('ended');
// //               appendLog('Call ended');
// //             }
// //           });
// //         },
// //       },
// //     });

// //     userAgentRef.current = userAgent;

// //     userAgent
// //       .start()
// //       .then(() => {
// //         const registerer = new Registerer(userAgent);
// //         return registerer.register();
// //       })
// //       .then(() => {
// //         setRegisterStatus(`Registered as ${EXT}`);
// //         appendLog('Registered successfully');
// //       })
// //       .catch((e: Error) => {
// //         setRegisterStatus('Registration failed');
// //         appendLog(`Registration failed: ${e.message}`);
// //       });

// //     // Deliberately no cleanup here. StrictMode's phantom
// //     // mount→cleanup→mount cycle would otherwise call userAgent.stop()
// //     // right after creating it, leaving the ref pointing at a dead
// //     // connection that the guard above then refuses to replace (since
// //     // the ref is already set).
// //     //
// //     // CAVEAT (this is what caused the "hangup from Zoiper doesn't update
// //     // the UI" bug): this trick only distinguishes StrictMode's synchronous
// //     // double-invoke from a real remount. It does NOT protect against Vite
// //     // Fast Refresh, which replaces the whole module (and therefore the ref)
// //     // on every save while developing — each save silently registers a new,
// //     // orphaned UserAgent as extension 1002 alongside the old one, so a BYE
// //     // from the far end can land on a session your current UI isn't
// //     // listening to. During dev, prefer a full page reload over relying on
// //     // HMR when testing live-call behavior. As a safety net for real tab
// //     // closes/navigation, explicitly stop the agent so Asterisk drops the
// //     // registration promptly instead of waiting out its expiry timer.
// //     const handleUnload = () => {
// //       userAgent.stop().catch(() => {});
// //     };
// //     window.addEventListener('beforeunload', handleUnload);
// //   }, []);

// //   // Shared between inbound accept() and outbound invite() — both end up
// //   // with a peerConnection on the session once the dialog is established;
// //   // this just wires its remote tracks into the <audio> element.
// //   function attachRemoteAudio(session: any) {
// //     const pc = session.sessionDescriptionHandler?.peerConnection;
// //     if (!pc) return;
// //     const remoteStream = new MediaStream();
// //     pc.getReceivers().forEach((r: RTCRtpReceiver) => r.track && remoteStream.addTrack(r.track));
// //     if (audioRef.current) audioRef.current.srcObject = remoteStream;
// //   }

// //   function answerCall() {
// //     const invitation = invitationRef.current;
// //     if (!invitation) return;
// //     invitation
// //       .accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } })
// //       .then(() => {
// //         setCallState('in-call');
// //         appendLog('Call answered');
// //         attachRemoteAudio(invitation);
// //       })
// //       .catch((e: Error) => appendLog(`Failed to answer: ${e.message}`));
// //   }

// //   /** Places an outbound call to whatever is in the dial box, using SIP.js's
// //    *  `Inviter` — the class for calls *we* originate (mirror image of
// //    *  `Invitation`, which onInvite hands us for calls we receive). Reuses
// //    *  the same userAgentRef connection/registration; no separate
// //    *  registration is needed to place a call. */
// //   function placeCall() {
// //     const target = dialNumber.trim();
// //     if (!target) return;

// //     const userAgent = userAgentRef.current;
// //     const classes = sipClassesRef.current;
// //     if (!userAgent || !classes) {
// //       appendLog('Cannot place call — softphone is not registered yet');
// //       return;
// //     }
// //     if (callState === 'ringing' || callState === 'in-call' || callState === 'calling') {
// //       appendLog('Cannot place call — already on a call');
// //       return;
// //     }

// //     const { UserAgent, Inviter } = classes;
// //     const targetURI = UserAgent.makeURI(`sip:${target}@${ASTERISK_HOST}`);
// //     if (!targetURI) {
// //       appendLog(`Invalid number/extension: ${target}`);
// //       return;
// //     }

// //     const inviter = new Inviter(userAgent, targetURI, {
// //       sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
// //     });
// //     invitationRef.current = inviter;

// //     // Outbound calls don't get a callId from an incoming INVITE — SIP.js
// //     // assigns the Call-ID header itself once .invite() builds the
// //     // request, so we read it back off the underlying request afterward.
// //     // Until then, generate a client-side placeholder so callId is never
// //     // null while callState === 'calling' (used to gate the ticket form).
// //     const provisionalCallId = `outbound-${Date.now()}`;
// //     setCallId(provisionalCallId);
// //     setCallerNumber(target);
// //     setCallDirection('outbound');
// //     setCallState('calling');
// //     setDialing(true);
// //     appendLog(`Calling ${target}...`);

// //     // Same redundant BYE signal as the inbound path — this is what was
// //     // missing before: on the *outbound* leg we never wired up onBye, only
// //     // stateChange, so a stale/duplicate session (see docblock note on
// //     // StrictMode/HMR remounts piling up UserAgents) could silently eat the
// //     // 'Terminated' transition and leave the UI stuck on "In call".
// //     inviter.delegate = {
// //       ...inviter.delegate,
// //       onBye: (bye: any) => {
// //         appendLog('Remote party hung up');
// //         setCallState('ended');
// //         bye.accept?.();
// //       },
// //     };

// //     inviter.stateChange.addListener((state: string) => {
// //       appendLog(`[outbound] session state → ${state}`);
// //       if (state === 'Established') {
// //         setCallState('in-call');
// //         appendLog('Call connected');
// //         attachRemoteAudio(inviter);
// //         const realCallId = inviter.request?.callId;
// //         if (realCallId) {
// //           setCallId(realCallId);
// //         }
// //       }
// //       if (state === 'Terminated') {
// //         setCallState('ended');
// //         appendLog('Call ended');
// //       }
// //     });

// //     inviter
// //       .invite()
// //       .then(() => {
// //         // INVITE sent — ringing on the far end. Real Call-ID is available
// //         // as soon as the request is built, so pick it up here too in case
// //         // Established fires before we'd otherwise read it.
// //         const realCallId = inviter.request?.callId;
// //         if (realCallId) setCallId(realCallId);
// //         notifyInboundCall(realCallId || provisionalCallId, target, EXT).catch((e) =>
// //           appendLog(`notifyInboundCall failed: ${e.message}`)
// //         );
// //       })
// //       .catch((e: Error) => {
// //         appendLog(`Failed to place call: ${e.message}`);
// //         setCallState('ended');
// //       })
// //       .finally(() => setDialing(false));
// //   }

// //   function hangupCall() {
// //     const session = invitationRef.current;
// //     if (!session) return;
// //     // `Inviter`/`Invitation` both expose .bye() once Established, but a
// //     // call we're still dialing out (state 'calling', not yet answered)
// //     // needs .cancel() instead — .bye() on an un-established session throws.
// //     if (callState === 'calling') {
// //       session.cancel().catch((e: Error) => appendLog(`Cancel failed: ${e.message}`));
// //     } else {
// //       session.bye().catch((e: Error) => appendLog(`Hangup failed: ${e.message}`));
// //     }
// //     setCallState('ended');
// //   }

// //   async function submitTicket(e: React.FormEvent) {
// //     e.preventDefault();
// //     if (!callId || !callerNumber) return;
// //     setSubmitting(true);
// //     setSubmitResult(null);
// //     try {
// //       const result = await createTicketFromCall(callId, {
// //         callerNumber,
// //         agentId: EXT,
// //         description,
// //         category,
// //         urgency,
// //       });
// //       setSubmitResult(
// //         result.skipped
// //           ? `Already ticketed as ${result.processInstanceId}`
// //           : `Ticket created: ${result.processInstanceId}`
// //       );
// //     } catch (err: any) {
// //       setSubmitResult(`Error: ${err.message}`);
// //     } finally {
// //       setSubmitting(false);
// //     }
// //   }

// //   const onACall = callState === 'ringing' || callState === 'calling' || callState === 'in-call';

// //   // callState 'ended' previously had no visual representation at all — the
// //   // colored status box simply disappeared the instant Terminated fired,
// //   // with the only confirmation buried in the small log list below. Show an
// //   // explicit "Call ended" banner for a few seconds, then drop back to the
// //   // plain idle dial-box view.
// //   useEffect(() => {
// //     if (callState !== 'ended') return;
// //     const t = setTimeout(() => setCallState('idle'), 3000);
// //     return () => clearTimeout(t);
// //   }, [callState]);

// //   // Belt-and-suspenders #2: relying purely on stateChange/onBye events is
// //   // fragile — a missed dispatch (delegate reassignment race, a WS hiccup,
// //   // whatever) leaves the UI showing "in call" forever with no way to
// //   // recover short of a page reload, which is exactly what was happening on
// //   // the second call above even though the first call's teardown worked
// //   // fine. This polls SIP.js's own authoritative `session.state` every
// //   // second while a call is active and force-syncs our React state if it
// //   // ever drifts — so the UI can never be stuck for more than ~1s.
// //   useEffect(() => {
// //     if (callState !== 'calling' && callState !== 'in-call' && callState !== 'ringing') return;
// //     const interval = setInterval(() => {
// //       const session = invitationRef.current;
// //       if (!session) return;
// //       const actualState = session.state; // SIP.js SessionState, e.g. 'Terminated'
// //       if (actualState === 'Terminated' && callState !== 'ended') {
// //         appendLog('[watchdog] session already terminated — syncing UI');
// //         setCallState('ended');
// //       }
// //     }, 1000);
// //     return () => clearInterval(interval);
// //   }, [callState]);


// //   return (
// //     <div className="agent-extension" style={{ display: 'flex', gap: 24, padding: 24 }}>
// //       <audio ref={audioRef} autoPlay />

// //       {/* Softphone panel */}
// //       <div style={{ flex: '0 0 280px' }}>
// //         <h3>Softphone — Extension {EXT}</h3>
// //         <div
// //           style={{
// //             padding: 10,
// //             borderRadius: 6,
// //             background: registerStatus.startsWith('Registered') ? '#d4edda' : '#f8d7da',
// //             marginBottom: 12,
// //           }}
// //         >
// //           {registerStatus}
// //         </div>

// //         {/* Outbound dial box — disabled while already on/placing a call */}
// //         <div style={{ marginBottom: 16 }}>
// //           <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
// //             Dial number / extension
// //           </label>
// //           <div style={{ display: 'flex', gap: 8 }}>
// //             <input
// //               value={dialNumber}
// //               onChange={(e) => setDialNumber(e.target.value)}
// //               placeholder="e.g. 1001"
// //               disabled={onACall || dialing}
// //               onKeyDown={(e) => {
// //                 if (e.key === 'Enter' && !onACall && !dialing && dialNumber.trim()) placeCall();
// //               }}
// //               style={{ flex: 1 }}
// //             />
// //             <button onClick={placeCall} disabled={onACall || dialing || !dialNumber.trim()}>
// //               {dialing ? 'Calling…' : 'Call'}
// //             </button>
// //           </div>
// //         </div>

// //         {callState === 'ringing' && callDirection === 'inbound' && (
// //           <div style={{ padding: 10, background: '#fff3cd', borderRadius: 6, marginBottom: 12 }}>
// //             Incoming call from {callerNumber}
// //             <div style={{ marginTop: 8 }}>
// //               <button onClick={answerCall}>Answer</button>
// //               <button onClick={hangupCall} style={{ marginLeft: 8 }}>
// //                 Decline
// //               </button>
// //             </div>
// //           </div>
// //         )}

// //         {callState === 'calling' && callDirection === 'outbound' && (
// //           <div style={{ padding: 10, background: '#e2e3ff', borderRadius: 6, marginBottom: 12 }}>
// //             Calling {callerNumber}…
// //             <div style={{ marginTop: 8 }}>
// //               <button onClick={hangupCall}>Cancel</button>
// //             </div>
// //           </div>
// //         )}

// //         {callState === 'in-call' && (
// //           <div style={{ padding: 10, background: '#cce5ff', borderRadius: 6, marginBottom: 12 }}>
// //             In call with {callerNumber} ({callDirection})
// //             <div style={{ marginTop: 8 }}>
// //               <button onClick={hangupCall}>Hang Up</button>
// //             </div>
// //           </div>
// //         )}

// //         {callState === 'ended' && (
// //           <div style={{ padding: 10, background: '#e9ecef', borderRadius: 6, marginBottom: 12, color: '#495057' }}>
// //             Call ended{callerNumber ? ` — ${callerNumber}` : ''}
// //           </div>
// //         )}

// //         <div style={{ fontSize: 12, color: '#555', background: '#fafafa', padding: 8, borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
// //           {log.map((line, i) => (
// //             <div key={i}>{line}</div>
// //           ))}
// //         </div>
// //       </div>

// //       {/* Screen-pop ticket form — BR-20, BR-21 (works for either direction) */}
// //       <div style={{ flex: 1 }}>
// //         <h3>Ticket</h3>
// //         {!callerNumber ? (
// //           <p style={{ color: '#888' }}>Waiting for an inbound call, or dial out to start one…</p>
// //         ) : (
// //           <form onSubmit={submitTicket} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
// //             <label>
// //               {callDirection === 'outbound' ? 'Called number' : 'Caller number'}
// //               <input value={callerNumber} disabled style={{ display: 'block', width: '100%' }} />
// //             </label>

// //             <label>
// //               Description
// //               <textarea
// //                 value={description}
// //                 onChange={(e) => setDescription(e.target.value)}
// //                 rows={4}
// //                 style={{ display: 'block', width: '100%' }}
// //                 required
// //               />
// //             </label>

// //             <label>
// //               Category
// //               <input
// //                 value={category}
// //                 onChange={(e) => setCategory(e.target.value)}
// //                 style={{ display: 'block', width: '100%' }}
// //               />
// //             </label>

// //             <label>
// //               Urgency
// //               <select value={urgency} onChange={(e) => setUrgency(e.target.value as any)} style={{ display: 'block', width: '100%' }}>
// //                 <option value="LOW">LOW</option>
// //                 <option value="MEDIUM">MEDIUM</option>
// //                 <option value="HIGH">HIGH</option>
// //               </select>
// //             </label>

// //             <button type="submit" disabled={submitting}>
// //               {submitting ? 'Creating…' : 'Create Ticket'}
// //             </button>

// //             {submitResult && <div>{submitResult}</div>}
// //           </form>
// //         )}
// //       </div>
// //     </div>
// //   );
// // }


// /**
//  * Agent Extension (BR-19 to BR-23), now with outbound calling.
//  *
//  * Registers a browser softphone (extension 1002 in the R&D Asterisk setup)
//  * via SIP.js. Handles two call directions:
//  *
//  *  - INBOUND: onInvite fires when a call rings in. Caller's number is
//  *    captured and POSTed to /api/calls/inbound so the screen-pop form
//  *    appears pre-filled (BR-20).
//  *
//  *  - OUTBOUND (new): the rep types a number/extension into the dial box
//  *    and clicks "Call". This builds a SIP.js `Inviter` (not `Invitation` —
//  *    that class is only for *receiving* a call) targeting
//  *    sip:<dialNumber>@ASTERISK_HOST and sends the INVITE ourselves.
//  *
//  * Both directions converge on the same screen-pop ticket form and the
//  * same POST /api/calls/:callId/create-ticket flow (BR-21) once a call is
//  * live — createTicketFromCall on the backend doesn't care which side
//  * originated the call, it just needs a callId + callerNumber.
//  *
//  * Swap ASTERISK_HOST/EXT/PASSWORD for your environment. In production this
//  * whole SIP.js block should sit behind a vendor-agnostic CTI Adapter
//  * interface per the BRD's Section 14.6, so swapping Asterisk for
//  * Twilio/another vendor doesn't touch this component's UI logic.
//  */
// import React, { useEffect, useRef, useState } from 'react';
// import { notifyInboundCall, createTicketFromCall } from './services/ticketApi';

// // ---- EDIT for your environment ----
// const ASTERISK_HOST = 'localhost';
// const EXT = '1002';
// const PASSWORD = 'changeme1002';
// // ------------------------------------

// type CallState = 'idle' | 'ringing' | 'calling' | 'in-call' | 'ended';
// type CallDirection = 'inbound' | 'outbound' | null;

// // ── Dialpad ──────────────────────────────────────────────────────────────
// // A desk-phone-style keypad: LCD-green digit readout on a dark handset
// // casing, real phone letter groupings under each digit. Doubles as a DTMF
// // pad once a call connects (see pressKey in the component below).
// const KEYPAD_ROWS: Array<Array<{ digit: string; sub: string }>> = [
//   [{ digit: '1', sub: '' }, { digit: '2', sub: 'ABC' }, { digit: '3', sub: 'DEF' }],
//   [{ digit: '4', sub: 'GHI' }, { digit: '5', sub: 'JKL' }, { digit: '6', sub: 'MNO' }],
//   [{ digit: '7', sub: 'PQRS' }, { digit: '8', sub: 'TUV' }, { digit: '9', sub: 'WXYZ' }],
//   [{ digit: '*', sub: '' }, { digit: '0', sub: '+' }, { digit: '#', sub: '' }],
// ];

// function KeyButton({
//   digit,
//   sub,
//   onPress,
//   disabled,
// }: {
//   digit: string;
//   sub: string;
//   onPress: () => void;
//   disabled: boolean;
// }) {
//   const [pressed, setPressed] = useState(false);
//   return (
//     <button
//       onClick={onPress}
//       disabled={disabled}
//       onMouseDown={() => setPressed(true)}
//       onMouseUp={() => setPressed(false)}
//       onMouseLeave={() => setPressed(false)}
//       style={{
//         width: 56,
//         height: 56,
//         borderRadius: 14,
//         border: '1px solid #333d54',
//         background: pressed ? '#3a4260' : '#262c3d',
//         color: disabled ? '#4b5266' : '#eceefa',
//         cursor: disabled ? 'default' : 'pointer',
//         display: 'flex',
//         flexDirection: 'column',
//         alignItems: 'center',
//         justifyContent: 'center',
//         transform: pressed ? 'scale(0.94)' : 'scale(1)',
//         transition: 'transform 80ms ease, background 120ms ease',
//         boxShadow: pressed ? 'none' : '0 2px 0 rgba(0,0,0,0.35)',
//         fontFamily: 'inherit',
//       }}
//     >
//       <span style={{ fontSize: 19, fontWeight: 600, lineHeight: 1 }}>{digit}</span>
//       <span style={{ fontSize: 8, letterSpacing: 1, color: '#7b8399', marginTop: 2, height: 8 }}>
//         {sub}
//       </span>
//     </button>
//   );
// }

// export default function AgentExtension() {
//   const [registerStatus, setRegisterStatus] = useState('Not registered');
//   const [callState, setCallState] = useState<CallState>('idle');
//   const [callDirection, setCallDirection] = useState<CallDirection>(null);
//   const [callId, setCallId] = useState<string | null>(null);
//   const [callerNumber, setCallerNumber] = useState<string | null>(null);
//   const [log, setLog] = useState<string[]>([]);

//   // Outbound dial box
//   const [dialNumber, setDialNumber] = useState('');
//   const [dialing, setDialing] = useState(false);

//   // Ticket form state (BR-21)
//   const [description, setDescription] = useState('');
//   const [category, setCategory] = useState('UNSPECIFIED');
//   const [urgency, setUrgency] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
//   const [submitting, setSubmitting] = useState(false);
//   const [submitResult, setSubmitResult] = useState<string | null>(null);

//   // Holds whichever session is currently active — an `Invitation` (we
//   // were called) or an `Inviter` (we placed the call). SIP.js exposes the
//   // same .accept()/.bye()/.stateChange surface on both once the dialog is
//   // established, but Inviter additionally needs .invite() to actually
//   // send the INVITE, which is why placeCall() below constructs one
//   // explicitly rather than reusing invitationRef for both directions.
//   const invitationRef = useRef<any>(null);
//   const audioRef = useRef<HTMLAudioElement>(null);

//   // React 18 StrictMode runs effects twice in dev (mount → cleanup →
//   // mount) to surface missing-cleanup bugs. A SIP UserAgent isn't safe to
//   // spin up twice in a row like that — the second registration races the
//   // first's teardown, leaving Zoiper connected to a session this
//   // component no longer holds a live reference to (Hang Up then only
//   // kills the orphaned first session, not the real one). This ref
//   // survives StrictMode's remount, so only the *second* (final) effect
//   // run actually creates the UserAgent — the first run's cleanup is a
//   // no-op instead of tearing down a real session.
//   const userAgentRef = useRef<any>(null);
//   // Keep the SIP.js `UserAgent` and `Inviter` *classes* (not instances)
//   // around too — placeCall() needs UserAgent.makeURI() and `new Inviter(...)`,
//   // and re-reading window.SIP from inside a button handler would be racy
//   // if the script tag loads late.
//   const sipClassesRef = useRef<{ UserAgent: any; Inviter: any } | null>(null);

//   function appendLog(msg: string) {
//     setLog((prev) => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
//   }

//   useEffect(() => {
//     if (userAgentRef.current) {
//       // Already set up (StrictMode's first pass, or a fast-refresh
//       // remount) — don't create a second competing session.
//       return;
//     }

//     // Loaded via index.html <script> tag (see integration notes) so it's
//     // available as window.SIP — dynamic import avoids a hard npm dependency
//     // for this R&D-stage component.
//     const SIP = (window as any).SIP;
//     if (!SIP) {
//       appendLog('SIP.js not found on window — check index.html script tag');
//       return;
//     }

//     const { UserAgent, Registerer, Inviter } = SIP;
//     sipClassesRef.current = { UserAgent, Inviter };

//     const uri = UserAgent.makeURI(`sip:${EXT}@${ASTERISK_HOST}`);

//     const userAgent = new UserAgent({
//       uri,
//       transportOptions: { server: `wss://${ASTERISK_HOST}:8089/ws` },
//       authorizationUsername: EXT,
//       authorizationPassword: PASSWORD,
//       delegate: {
//         onInvite(invitation: any) {
//           invitationRef.current = invitation;
//           const caller = invitation.remoteIdentity.uri.user;
//           const newCallId = invitation.request.callId;

//           setCallDirection('inbound');
//           setCallId(newCallId);
//           setCallerNumber(caller);
//           setCallState('ringing');
//           appendLog(`Incoming call from ${caller}`);

//           // BR-20: notify backend so the screen-pop has caller info ready
//           notifyInboundCall(newCallId, caller, EXT).catch((e) =>
//             appendLog(`notifyInboundCall failed: ${e.message}`)
//           );

//           // Redundant, more direct signal for "the far end hung up" — fires
//           // specifically on an incoming BYE, independent of the generic
//           // stateChange below. Belt-and-suspenders against races where a
//           // stale session (see StrictMode/HMR note in the component
//           // docblock) swallows the stateChange event.
//           invitation.delegate = {
//             ...invitation.delegate,
//             onBye: (bye: any) => {
//               appendLog('Remote party hung up');
//               setCallState('ended');
//               bye.accept?.();
//             },
//           };

//           invitation.stateChange.addListener((state: string) => {
//             appendLog(`[inbound] session state → ${state}`);
//             if (state === 'Established') {
//               setCallState('in-call');
//               attachRemoteAudio(invitation);
//             }
//             if (state === 'Terminated') {
//               setCallState('ended');
//               appendLog('Call ended');
//             }
//           });
//         },
//       },
//     });

//     userAgentRef.current = userAgent;

//     userAgent
//       .start()
//       .then(() => {
//         const registerer = new Registerer(userAgent);
//         return registerer.register();
//       })
//       .then(() => {
//         setRegisterStatus(`Registered as ${EXT}`);
//         appendLog('Registered successfully');
//       })
//       .catch((e: Error) => {
//         setRegisterStatus('Registration failed');
//         appendLog(`Registration failed: ${e.message}`);
//       });

//     // Deliberately no cleanup here. StrictMode's phantom
//     // mount→cleanup→mount cycle would otherwise call userAgent.stop()
//     // right after creating it, leaving the ref pointing at a dead
//     // connection that the guard above then refuses to replace (since
//     // the ref is already set).
//     //
//     // CAVEAT (this is what caused the "hangup from Zoiper doesn't update
//     // the UI" bug): this trick only distinguishes StrictMode's synchronous
//     // double-invoke from a real remount. It does NOT protect against Vite
//     // Fast Refresh, which replaces the whole module (and therefore the ref)
//     // on every save while developing — each save silently registers a new,
//     // orphaned UserAgent as extension 1002 alongside the old one, so a BYE
//     // from the far end can land on a session your current UI isn't
//     // listening to. During dev, prefer a full page reload over relying on
//     // HMR when testing live-call behavior. As a safety net for real tab
//     // closes/navigation, explicitly stop the agent so Asterisk drops the
//     // registration promptly instead of waiting out its expiry timer.
//     const handleUnload = () => {
//       userAgent.stop().catch(() => {});
//     };
//     window.addEventListener('beforeunload', handleUnload);
//   }, []);

//   // Shared between inbound accept() and outbound invite() — both end up
//   // with a peerConnection on the session once the dialog is established;
//   // this just wires its remote tracks into the <audio> element.
//   function attachRemoteAudio(session: any) {
//     const pc = session.sessionDescriptionHandler?.peerConnection;
//     if (!pc) return;
//     const remoteStream = new MediaStream();
//     pc.getReceivers().forEach((r: RTCRtpReceiver) => r.track && remoteStream.addTrack(r.track));
//     if (audioRef.current) audioRef.current.srcObject = remoteStream;
//   }

//   function answerCall() {
//     const invitation = invitationRef.current;
//     if (!invitation) return;
//     invitation
//       .accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } })
//       .then(() => {
//         setCallState('in-call');
//         appendLog('Call answered');
//         attachRemoteAudio(invitation);
//       })
//       .catch((e: Error) => appendLog(`Failed to answer: ${e.message}`));
//   }

//   /** Places an outbound call to whatever is in the dial box, using SIP.js's
//    *  `Inviter` — the class for calls *we* originate (mirror image of
//    *  `Invitation`, which onInvite hands us for calls we receive). Reuses
//    *  the same userAgentRef connection/registration; no separate
//    *  registration is needed to place a call. */
//   function placeCall() {
//     const target = dialNumber.trim();
//     if (!target) return;

//     const userAgent = userAgentRef.current;
//     const classes = sipClassesRef.current;
//     if (!userAgent || !classes) {
//       appendLog('Cannot place call — softphone is not registered yet');
//       return;
//     }
//     if (callState === 'ringing' || callState === 'in-call' || callState === 'calling') {
//       appendLog('Cannot place call — already on a call');
//       return;
//     }

//     const { UserAgent, Inviter } = classes;
//     const targetURI = UserAgent.makeURI(`sip:${target}@${ASTERISK_HOST}`);
//     if (!targetURI) {
//       appendLog(`Invalid number/extension: ${target}`);
//       return;
//     }

//     const inviter = new Inviter(userAgent, targetURI, {
//       sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
//     });
//     invitationRef.current = inviter;

//     // Outbound calls don't get a callId from an incoming INVITE — SIP.js
//     // assigns the Call-ID header itself once .invite() builds the
//     // request, so we read it back off the underlying request afterward.
//     // Until then, generate a client-side placeholder so callId is never
//     // null while callState === 'calling' (used to gate the ticket form).
//     const provisionalCallId = `outbound-${Date.now()}`;
//     setCallId(provisionalCallId);
//     setCallerNumber(target);
//     setCallDirection('outbound');
//     setCallState('calling');
//     setDialing(true);
//     appendLog(`Calling ${target}...`);

//     // Same redundant BYE signal as the inbound path — this is what was
//     // missing before: on the *outbound* leg we never wired up onBye, only
//     // stateChange, so a stale/duplicate session (see docblock note on
//     // StrictMode/HMR remounts piling up UserAgents) could silently eat the
//     // 'Terminated' transition and leave the UI stuck on "In call".
//     inviter.delegate = {
//       ...inviter.delegate,
//       onBye: (bye: any) => {
//         appendLog('Remote party hung up');
//         setCallState('ended');
//         bye.accept?.();
//       },
//     };

//     inviter.stateChange.addListener((state: string) => {
//       appendLog(`[outbound] session state → ${state}`);
//       if (state === 'Established') {
//         setCallState('in-call');
//         appendLog('Call connected');
//         attachRemoteAudio(inviter);
//         const realCallId = inviter.request?.callId;
//         if (realCallId) {
//           setCallId(realCallId);
//         }
//       }
//       if (state === 'Terminated') {
//         setCallState('ended');
//         appendLog('Call ended');
//       }
//     });

//     inviter
//       .invite()
//       .then(() => {
//         // INVITE sent — ringing on the far end. Real Call-ID is available
//         // as soon as the request is built, so pick it up here too in case
//         // Established fires before we'd otherwise read it.
//         const realCallId = inviter.request?.callId;
//         if (realCallId) setCallId(realCallId);
//         notifyInboundCall(realCallId || provisionalCallId, target, EXT).catch((e) =>
//           appendLog(`notifyInboundCall failed: ${e.message}`)
//         );
//       })
//       .catch((e: Error) => {
//         appendLog(`Failed to place call: ${e.message}`);
//         setCallState('ended');
//       })
//       .finally(() => setDialing(false));
//   }

//   function hangupCall() {
//     const session = invitationRef.current;
//     if (!session) return;
//     // `Inviter`/`Invitation` both expose .bye() once Established, but a
//     // call we're still dialing out (state 'calling', not yet answered)
//     // needs .cancel() instead — .bye() on an un-established session throws.
//     if (callState === 'calling') {
//       session.cancel().catch((e: Error) => appendLog(`Cancel failed: ${e.message}`));
//     } else {
//       session.bye().catch((e: Error) => appendLog(`Hangup failed: ${e.message}`));
//     }
//     setCallState('ended');
//   }

//   /** Keypad presses do double duty, like a real desk phone: before/while
//    *  dialing, digits build up the number in the LCD display; once a call
//    *  is actually connected, the same buttons send DTMF tones over the
//    *  live audio stream instead (for IVRs, extensions, etc.) rather than
//    *  editing a number there's no reason to edit mid-call. */
//   function pressKey(key: string) {
//     if (callState === 'in-call') {
//       const session = invitationRef.current;
//       const sender = session?.sessionDescriptionHandler?.sendDtmf;
//       if (typeof sender === 'function') {
//         try {
//           session.sessionDescriptionHandler.sendDtmf(key);
//           appendLog(`DTMF sent: ${key}`);
//         } catch (e: any) {
//           appendLog(`DTMF failed: ${e.message}`);
//         }
//       }
//       return;
//     }
//     if (onACall) return; // ringing/calling — keypad is inert, not editable
//     setDialNumber((prev) => prev + key);
//   }

//   function backspace() {
//     if (onACall) return;
//     setDialNumber((prev) => prev.slice(0, -1));
//   }

//   async function submitTicket(e: React.FormEvent) {
//     e.preventDefault();
//     if (!callId || !callerNumber) return;
//     setSubmitting(true);
//     setSubmitResult(null);
//     try {
//       const result = await createTicketFromCall(callId, {
//         callerNumber,
//         agentId: EXT,
//         description,
//         category,
//         urgency,
//       });
//       setSubmitResult(
//         result.skipped
//           ? `Already ticketed as ${result.processInstanceId}`
//           : `Ticket created: ${result.processInstanceId}`
//       );
//     } catch (err: any) {
//       setSubmitResult(`Error: ${err.message}`);
//     } finally {
//       setSubmitting(false);
//     }
//   }

//   const onACall = callState === 'ringing' || callState === 'calling' || callState === 'in-call';

//   // callState 'ended' previously had no visual representation at all — the
//   // colored status box simply disappeared the instant Terminated fired,
//   // with the only confirmation buried in the small log list below. Show an
//   // explicit "Call ended" banner for a few seconds, then drop back to the
//   // plain idle dial-box view.
//   useEffect(() => {
//     if (callState !== 'ended') return;
//     const t = setTimeout(() => setCallState('idle'), 3000);
//     return () => clearTimeout(t);
//   }, [callState]);

//   // Belt-and-suspenders #2: relying purely on stateChange/onBye events is
//   // fragile — a missed dispatch (delegate reassignment race, a WS hiccup,
//   // whatever) leaves the UI showing "in call" forever with no way to
//   // recover short of a page reload, which is exactly what was happening on
//   // the second call above even though the first call's teardown worked
//   // fine. This polls SIP.js's own authoritative `session.state` every
//   // second while a call is active and force-syncs our React state if it
//   // ever drifts — so the UI can never be stuck for more than ~1s.
//   useEffect(() => {
//     if (callState !== 'calling' && callState !== 'in-call' && callState !== 'ringing') return;
//     const interval = setInterval(() => {
//       const session = invitationRef.current;
//       if (!session) return;
//       const actualState = session.state; // SIP.js SessionState, e.g. 'Terminated'
//       if (actualState === 'Terminated' && callState !== 'ended') {
//         appendLog('[watchdog] session already terminated — syncing UI');
//         setCallState('ended');
//       }
//     }, 1000);
//     return () => clearInterval(interval);
//   }, [callState]);


//   return (
//     <div className="agent-extension" style={{ display: 'flex', gap: 24, padding: 24 }}>
//       <audio ref={audioRef} autoPlay />

//       {/* Softphone panel */}
//       <div style={{ flex: '0 0 280px' }}>
//         <h3>Softphone — Extension {EXT}</h3>
//         <div
//           style={{
//             padding: 10,
//             borderRadius: 6,
//             background: registerStatus.startsWith('Registered') ? '#d4edda' : '#f8d7da',
//             marginBottom: 12,
//           }}
//         >
//           {registerStatus}
//         </div>

//         {/* Dialpad — LCD-style readout + keypad. Digits build the dialed
//             number when idle; once connected the same keys send DTMF
//             instead (see pressKey). The action button below the grid is the
//             single control for placing/cancelling/ending an outbound call. */}
//         <div
//           style={{
//             background: 'linear-gradient(160deg, #1c2333, #12151f)',
//             borderRadius: 20,
//             padding: 16,
//             marginBottom: 16,
//             boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
//           }}
//         >
//           <div
//             style={{
//               background: '#08130d',
//               borderRadius: 10,
//               padding: '10px 12px',
//               marginBottom: 14,
//               display: 'flex',
//               alignItems: 'center',
//               justifyContent: 'space-between',
//               border: '1px solid #16261a',
//             }}
//           >
//             <input
//               value={callState === 'calling' || callState === 'in-call' ? callerNumber || '' : dialNumber}
//               onChange={(e) => !onACall && setDialNumber(e.target.value)}
//               readOnly={onACall}
//               placeholder="Enter number"
//               onKeyDown={(e) => {
//                 if (e.key === 'Enter' && !onACall && dialNumber.trim()) placeCall();
//               }}
//               style={{
//                 flex: 1,
//                 background: 'transparent',
//                 border: 'none',
//                 outline: 'none',
//                 color: '#6ffcb0',
//                 fontFamily: "'Roboto Mono', 'SF Mono', Consolas, monospace",
//                 fontSize: 20,
//                 letterSpacing: 2,
//               }}
//             />
//             {!onACall && dialNumber && (
//               <button
//                 onClick={backspace}
//                 aria-label="Backspace"
//                 style={{
//                   background: 'none',
//                   border: 'none',
//                   color: '#4d8f6c',
//                   fontSize: 18,
//                   cursor: 'pointer',
//                   padding: '0 4px',
//                 }}
//               >
//                 ⌫
//               </button>
//             )}
//           </div>

//           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 10, justifyContent: 'center' }}>
//             {KEYPAD_ROWS.flat().map(({ digit, sub }) => (
//               <KeyButton
//                 key={digit}
//                 digit={digit}
//                 sub={sub}
//                 onPress={() => pressKey(digit)}
//                 disabled={callState === 'ringing' || callState === 'calling' || dialing}
//               />
//             ))}
//           </div>

//           <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
//             {callState === 'ringing' ? (
//               <div style={{ fontSize: 12, color: '#7b8399' }}>Answer/decline below ↓</div>
//             ) : callState === 'calling' || callState === 'in-call' ? (
//               <button
//                 onClick={hangupCall}
//                 aria-label="End call"
//                 style={{
//                   width: 56,
//                   height: 56,
//                   borderRadius: '50%',
//                   border: 'none',
//                   background: '#e5484d',
//                   color: '#fff',
//                   fontSize: 22,
//                   cursor: 'pointer',
//                   boxShadow: '0 4px 10px rgba(229,72,77,0.4)',
//                   transform: 'rotate(135deg)',
//                 }}
//               >
//                 ☎
//               </button>
//             ) : (
//               <button
//                 onClick={placeCall}
//                 disabled={dialing || !dialNumber.trim()}
//                 aria-label="Call"
//                 style={{
//                   width: 56,
//                   height: 56,
//                   borderRadius: '50%',
//                   border: 'none',
//                   background: !dialNumber.trim() ? '#2b6b48' : '#24c274',
//                   color: '#fff',
//                   fontSize: 22,
//                   cursor: !dialNumber.trim() || dialing ? 'default' : 'pointer',
//                   boxShadow: !dialNumber.trim() ? 'none' : '0 4px 10px rgba(36,194,116,0.4)',
//                 }}
//               >
//                 ☎
//               </button>
//             )}
//           </div>
//         </div>

//         {callState === 'ringing' && callDirection === 'inbound' && (
//           <div style={{ padding: 10, background: '#fff3cd', borderRadius: 6, marginBottom: 12 }}>
//             Incoming call from {callerNumber}
//             <div style={{ marginTop: 8 }}>
//               <button onClick={answerCall}>Answer</button>
//               <button onClick={hangupCall} style={{ marginLeft: 8 }}>
//                 Decline
//               </button>
//             </div>
//           </div>
//         )}

//         {callState === 'calling' && callDirection === 'outbound' && (
//           <div style={{ padding: 10, background: '#e2e3ff', borderRadius: 6, marginBottom: 12 }}>
//             Calling {callerNumber}…
//           </div>
//         )}


//         {callState === 'in-call' && (
//           <div style={{ padding: 10, background: '#cce5ff', borderRadius: 6, marginBottom: 12 }}>
//             In call with {callerNumber} ({callDirection})
//           </div>
//         )}

//         {callState === 'ended' && (
//           <div style={{ padding: 10, background: '#e9ecef', borderRadius: 6, marginBottom: 12, color: '#495057' }}>
//             Call ended{callerNumber ? ` — ${callerNumber}` : ''}
//           </div>
//         )}

//         <div style={{ fontSize: 12, color: '#555', background: '#fafafa', padding: 8, borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
//           {log.map((line, i) => (
//             <div key={i}>{line}</div>
//           ))}
//         </div>
//       </div>

//       {/* Screen-pop ticket form — BR-20, BR-21 (works for either direction) */}
//       <div style={{ flex: 1 }}>
//         <h3>Ticket</h3>
//         {!callerNumber ? (
//           <p style={{ color: '#888' }}>Waiting for an inbound call, or dial out to start one…</p>
//         ) : (
//           <form onSubmit={submitTicket} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
//             <label>
//               {callDirection === 'outbound' ? 'Called number' : 'Caller number'}
//               <input value={callerNumber} disabled style={{ display: 'block', width: '100%' }} />
//             </label>

//             <label>
//               Description
//               <textarea
//                 value={description}
//                 onChange={(e) => setDescription(e.target.value)}
//                 rows={4}
//                 style={{ display: 'block', width: '100%' }}
//                 required
//               />
//             </label>

//             <label>
//               Category
//               <input
//                 value={category}
//                 onChange={(e) => setCategory(e.target.value)}
//                 style={{ display: 'block', width: '100%' }}
//               />
//             </label>

//             <label>
//               Urgency
//               <select value={urgency} onChange={(e) => setUrgency(e.target.value as any)} style={{ display: 'block', width: '100%' }}>
//                 <option value="LOW">LOW</option>
//                 <option value="MEDIUM">MEDIUM</option>
//                 <option value="HIGH">HIGH</option>
//               </select>
//             </label>

//             <button type="submit" disabled={submitting}>
//               {submitting ? 'Creating…' : 'Create Ticket'}
//             </button>

//             {submitResult && <div>{submitResult}</div>}
//           </form>
//         )}
//       </div>
//     </div>
//   );
// }


/**
 * Agent Extension (BR-19 to BR-23), now with outbound calling.
 *
 * Registers a browser softphone (extension 1002 in the R&D Asterisk setup)
 * via SIP.js. Handles two call directions:
 *
 *  - INBOUND: onInvite fires when a call rings in. Caller's number is
 *    captured and POSTed to /api/calls/inbound so the screen-pop form
 *    appears pre-filled (BR-20).
 *
 *  - OUTBOUND (new): the rep types a number/extension into the dial box
 *    and clicks "Call". This builds a SIP.js `Inviter` (not `Invitation` —
 *    that class is only for *receiving* a call) targeting
 *    sip:<dialNumber>@ASTERISK_HOST and sends the INVITE ourselves.
 *
 * Both directions converge on the same screen-pop ticket form and the
 * same POST /api/calls/:callId/create-ticket flow (BR-21) once a call is
 * live — createTicketFromCall on the backend doesn't care which side
 * originated the call, it just needs a callId + callerNumber.
 *
 * Swap ASTERISK_HOST/EXT/PASSWORD for your environment. In production this
 * whole SIP.js block should sit behind a vendor-agnostic CTI Adapter
 * interface per the BRD's Section 14.6, so swapping Asterisk for
 * Twilio/another vendor doesn't touch this component's UI logic.
 */
import React, { useEffect, useRef, useState } from 'react';
import { notifyInboundCall, createTicketFromCall } from './services/ticketApi';

// ---- EDIT for your environment ----
const ASTERISK_HOST = 'localhost';
const EXT = '1002';
const PASSWORD = 'changeme1002';
// ------------------------------------

type CallState = 'idle' | 'ringing' | 'calling' | 'in-call' | 'ended';
type CallDirection = 'inbound' | 'outbound' | null;

// ── Dialpad ──────────────────────────────────────────────────────────────
// A desk-phone-style keypad: LCD-green digit readout on a dark handset
// casing, real phone letter groupings under each digit. Doubles as a DTMF
// pad once a call connects (see pressKey in the component below).
const KEYPAD_ROWS: Array<Array<{ digit: string; sub: string }>> = [
  [{ digit: '1', sub: '' }, { digit: '2', sub: 'ABC' }, { digit: '3', sub: 'DEF' }],
  [{ digit: '4', sub: 'GHI' }, { digit: '5', sub: 'JKL' }, { digit: '6', sub: 'MNO' }],
  [{ digit: '7', sub: 'PQRS' }, { digit: '8', sub: 'TUV' }, { digit: '9', sub: 'WXYZ' }],
  [{ digit: '*', sub: '' }, { digit: '0', sub: '+' }, { digit: '#', sub: '' }],
];

function KeyButton({
  digit,
  sub,
  onPress,
  disabled,
}: {
  digit: string;
  sub: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onPress}
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        border: '1px solid #333d54',
        background: pressed ? '#3a4260' : '#262c3d',
        color: disabled ? '#4b5266' : '#eceefa',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transform: pressed ? 'scale(0.94)' : 'scale(1)',
        transition: 'transform 80ms ease, background 120ms ease',
        boxShadow: pressed ? 'none' : '0 2px 0 rgba(0,0,0,0.35)',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 19, fontWeight: 600, lineHeight: 1 }}>{digit}</span>
      <span style={{ fontSize: 8, letterSpacing: 1, color: '#7b8399', marginTop: 2, height: 8 }}>
        {sub}
      </span>
    </button>
  );
}

export default function AgentExtension() {
  const [registerStatus, setRegisterStatus] = useState('Not registered');
  const [callState, setCallState] = useState<CallState>('idle');
  const [callDirection, setCallDirection] = useState<CallDirection>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callerNumber, setCallerNumber] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Outbound dial box
  const [dialNumber, setDialNumber] = useState('');
  const [dialing, setDialing] = useState(false);

  // Ticket form state (BR-21)
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('UNSPECIFIED');
  const [urgency, setUrgency] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // Holds whichever session is currently active — an `Invitation` (we
  // were called) or an `Inviter` (we placed the call). SIP.js exposes the
  // same .accept()/.bye()/.stateChange surface on both once the dialog is
  // established, but Inviter additionally needs .invite() to actually
  // send the INVITE, which is why placeCall() below constructs one
  // explicitly rather than reusing invitationRef for both directions.
  const invitationRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // React 18 StrictMode runs effects twice in dev (mount → cleanup →
  // mount) to surface missing-cleanup bugs. A SIP UserAgent isn't safe to
  // spin up twice in a row like that — the second registration races the
  // first's teardown, leaving Zoiper connected to a session this
  // component no longer holds a live reference to (Hang Up then only
  // kills the orphaned first session, not the real one). This ref
  // survives StrictMode's remount, so only the *second* (final) effect
  // run actually creates the UserAgent — the first run's cleanup is a
  // no-op instead of tearing down a real session.
  const userAgentRef = useRef<any>(null);
  // Keep the SIP.js `UserAgent` and `Inviter` *classes* (not instances)
  // around too — placeCall() needs UserAgent.makeURI() and `new Inviter(...)`,
  // and re-reading window.SIP from inside a button handler would be racy
  // if the script tag loads late.
  const sipClassesRef = useRef<{ UserAgent: any; Inviter: any } | null>(null);

  function appendLog(msg: string) {
    setLog((prev) => [...prev.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  useEffect(() => {
    if (userAgentRef.current) {
      // Already set up (StrictMode's first pass, or a fast-refresh
      // remount) — don't create a second competing session.
      return;
    }

    // Loaded via index.html <script> tag (see integration notes) so it's
    // available as window.SIP — dynamic import avoids a hard npm dependency
    // for this R&D-stage component.
    const SIP = (window as any).SIP;
    if (!SIP) {
      appendLog('SIP.js not found on window — check index.html script tag');
      return;
    }

    const { UserAgent, Registerer, Inviter } = SIP;
    sipClassesRef.current = { UserAgent, Inviter };

    const uri = UserAgent.makeURI(`sip:${EXT}@${ASTERISK_HOST}`);

    const userAgent = new UserAgent({
      uri,
      transportOptions: { server: `wss://${ASTERISK_HOST}:8089/ws` },
      authorizationUsername: EXT,
      authorizationPassword: PASSWORD,
      delegate: {
        onInvite(invitation: any) {
          invitationRef.current = invitation;
          const caller = invitation.remoteIdentity.uri.user;
          const newCallId = invitation.request.callId;

          setCallDirection('inbound');
          setCallId(newCallId);
          setCallerNumber(caller);
          setCallState('ringing');
          appendLog(`Incoming call from ${caller}`);

          // BR-20: notify backend so the screen-pop has caller info ready
          notifyInboundCall(newCallId, caller, EXT).catch((e) =>
            appendLog(`notifyInboundCall failed: ${e.message}`)
          );

          // Redundant, more direct signal for "the far end hung up" — fires
          // specifically on an incoming BYE, independent of the generic
          // stateChange below. Belt-and-suspenders against races where a
          // stale session (see StrictMode/HMR note in the component
          // docblock) swallows the stateChange event.
          invitation.delegate = {
            ...invitation.delegate,
            onBye: (bye: any) => {
              appendLog('Remote party hung up');
              setCallState('ended');
              bye.accept?.();
            },
          };

          invitation.stateChange.addListener((state: string) => {
            appendLog(`[inbound] session state → ${state}`);
            if (state === 'Established') {
              setCallState('in-call');
              attachRemoteAudio(invitation);
            }
            if (state === 'Terminated') {
              setCallState('ended');
              appendLog('Call ended');
            }
          });
        },
      },
    });

    userAgentRef.current = userAgent;

    userAgent
      .start()
      .then(() => {
        const registerer = new Registerer(userAgent);
        return registerer.register();
      })
      .then(() => {
        setRegisterStatus(`Registered as ${EXT}`);
        appendLog('Registered successfully');
      })
      .catch((e: Error) => {
        setRegisterStatus('Registration failed');
        appendLog(`Registration failed: ${e.message}`);
      });

    // Deliberately no cleanup here. StrictMode's phantom
    // mount→cleanup→mount cycle would otherwise call userAgent.stop()
    // right after creating it, leaving the ref pointing at a dead
    // connection that the guard above then refuses to replace (since
    // the ref is already set).
    //
    // CAVEAT (this is what caused the "hangup from Zoiper doesn't update
    // the UI" bug): this trick only distinguishes StrictMode's synchronous
    // double-invoke from a real remount. It does NOT protect against Vite
    // Fast Refresh, which replaces the whole module (and therefore the ref)
    // on every save while developing — each save silently registers a new,
    // orphaned UserAgent as extension 1002 alongside the old one, so a BYE
    // from the far end can land on a session your current UI isn't
    // listening to. During dev, prefer a full page reload over relying on
    // HMR when testing live-call behavior. As a safety net for real tab
    // closes/navigation, explicitly stop the agent so Asterisk drops the
    // registration promptly instead of waiting out its expiry timer.
    const handleUnload = () => {
      userAgent.stop().catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);
  }, []);

  // Shared between inbound accept() and outbound invite() — both end up
  // with a peerConnection on the session once the dialog is established;
  // this just wires its remote tracks into the <audio> element.
  function attachRemoteAudio(session: any) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    const remoteStream = new MediaStream();
    pc.getReceivers().forEach((r: RTCRtpReceiver) => r.track && remoteStream.addTrack(r.track));
    if (audioRef.current) audioRef.current.srcObject = remoteStream;
  }

  function answerCall() {
    const invitation = invitationRef.current;
    if (!invitation) return;
    invitation
      .accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } })
      .then(() => {
        setCallState('in-call');
        appendLog('Call answered');
        attachRemoteAudio(invitation);
      })
      .catch((e: Error) => appendLog(`Failed to answer: ${e.message}`));
  }

  /** Places an outbound call to whatever is in the dial box, using SIP.js's
   *  `Inviter` — the class for calls *we* originate (mirror image of
   *  `Invitation`, which onInvite hands us for calls we receive). Reuses
   *  the same userAgentRef connection/registration; no separate
   *  registration is needed to place a call. */
  function placeCall() {
    const target = dialNumber.trim();
    if (!target) return;

    const userAgent = userAgentRef.current;
    const classes = sipClassesRef.current;
    if (!userAgent || !classes) {
      appendLog('Cannot place call — softphone is not registered yet');
      return;
    }
    if (callState === 'ringing' || callState === 'in-call' || callState === 'calling') {
      appendLog('Cannot place call — already on a call');
      return;
    }

    const { UserAgent, Inviter } = classes;
    const targetURI = UserAgent.makeURI(`sip:${target}@${ASTERISK_HOST}`);
    if (!targetURI) {
      appendLog(`Invalid number/extension: ${target}`);
      return;
    }

    const inviter = new Inviter(userAgent, targetURI, {
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
    invitationRef.current = inviter;

    // Outbound calls don't get a callId from an incoming INVITE — SIP.js
    // assigns the Call-ID header itself once .invite() builds the
    // request, so we read it back off the underlying request afterward.
    // Until then, generate a client-side placeholder so callId is never
    // null while callState === 'calling' (used to gate the ticket form).
    const provisionalCallId = `outbound-${Date.now()}`;
    setCallId(provisionalCallId);
    setCallerNumber(target);
    setCallDirection('outbound');
    setCallState('calling');
    setDialing(true);
    appendLog(`Calling ${target}...`);

    // Same redundant BYE signal as the inbound path — this is what was
    // missing before: on the *outbound* leg we never wired up onBye, only
    // stateChange, so a stale/duplicate session (see docblock note on
    // StrictMode/HMR remounts piling up UserAgents) could silently eat the
    // 'Terminated' transition and leave the UI stuck on "In call".
    inviter.delegate = {
      ...inviter.delegate,
      onBye: (bye: any) => {
        appendLog('Remote party hung up');
        setCallState('ended');
        bye.accept?.();
      },
    };

    inviter.stateChange.addListener((state: string) => {
      appendLog(`[outbound] session state → ${state}`);
      if (state === 'Established') {
        setCallState('in-call');
        appendLog('Call connected');
        attachRemoteAudio(inviter);
        const realCallId = inviter.request?.callId;
        if (realCallId) {
          setCallId(realCallId);
        }
      }
      if (state === 'Terminated') {
        setCallState('ended');
        appendLog('Call ended');
      }
    });

    inviter
      .invite()
      .then(() => {
        // INVITE sent — ringing on the far end. Real Call-ID is available
        // as soon as the request is built, so pick it up here too in case
        // Established fires before we'd otherwise read it.
        const realCallId = inviter.request?.callId;
        if (realCallId) setCallId(realCallId);
        notifyInboundCall(realCallId || provisionalCallId, target, EXT).catch((e) =>
          appendLog(`notifyInboundCall failed: ${e.message}`)
        );
      })
      .catch((e: Error) => {
        appendLog(`Failed to place call: ${e.message}`);
        setCallState('ended');
      })
      .finally(() => setDialing(false));
  }

  function hangupCall() {
    const session = invitationRef.current;
    if (!session) return;
    // `Inviter`/`Invitation` both expose .bye() once Established, but a
    // call we're still dialing out (state 'calling', not yet answered)
    // needs .cancel() instead — .bye() on an un-established session throws.
    if (callState === 'calling') {
      session.cancel().catch((e: Error) => appendLog(`Cancel failed: ${e.message}`));
    } else {
      session.bye().catch((e: Error) => appendLog(`Hangup failed: ${e.message}`));
    }
    setCallState('ended');
  }

  /** Keypad presses do double duty, like a real desk phone: before/while
   *  dialing, digits build up the number in the LCD display; once a call
   *  is actually connected, the same buttons send DTMF tones over the
   *  live audio stream instead (for IVRs, extensions, etc.) rather than
   *  editing a number there's no reason to edit mid-call. */
  function pressKey(key: string) {
    if (callState === 'in-call') {
      const session = invitationRef.current;
      const sender = session?.sessionDescriptionHandler?.sendDtmf;
      if (typeof sender === 'function') {
        try {
          session.sessionDescriptionHandler.sendDtmf(key);
          appendLog(`DTMF sent: ${key}`);
        } catch (e: any) {
          appendLog(`DTMF failed: ${e.message}`);
        }
      }
      return;
    }
    if (onACall) return; // ringing/calling — keypad is inert, not editable
    setDialNumber((prev) => prev + key);
  }

  function backspace() {
    if (onACall) return;
    setDialNumber((prev) => prev.slice(0, -1));
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!callId || !callerNumber) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const result = await createTicketFromCall(callId, {
        callerNumber,
        agentId: EXT,
        description,
        category,
        urgency,
      });
      setSubmitResult(
        result.skipped
          ? `Already ticketed as ${result.processInstanceId}`
          : `Ticket created: ${result.processInstanceId}`
      );
    } catch (err: any) {
      setSubmitResult(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const onACall = callState === 'ringing' || callState === 'calling' || callState === 'in-call';

  // callState 'ended' previously had no visual representation at all — the
  // colored status box simply disappeared the instant Terminated fired,
  // with the only confirmation buried in the small log list below. Show an
  // explicit "Call ended" banner for a few seconds, then drop back to the
  // plain idle dial-box view.
  useEffect(() => {
    if (callState !== 'ended') return;
    const t = setTimeout(() => setCallState('idle'), 3000);
    return () => clearTimeout(t);
  }, [callState]);

  // Belt-and-suspenders #2: relying purely on stateChange/onBye events is
  // fragile — a missed dispatch (delegate reassignment race, a WS hiccup,
  // whatever) leaves the UI showing "in call" forever with no way to
  // recover short of a page reload, which is exactly what was happening on
  // the second call above even though the first call's teardown worked
  // fine. This polls SIP.js's own authoritative `session.state` every
  // second while a call is active and force-syncs our React state if it
  // ever drifts — so the UI can never be stuck for more than ~1s.
  useEffect(() => {
    if (callState !== 'calling' && callState !== 'in-call' && callState !== 'ringing') return;
    const interval = setInterval(() => {
      const session = invitationRef.current;
      if (!session) return;
      const actualState = session.state; // SIP.js SessionState, e.g. 'Terminated'
      if (actualState === 'Terminated' && callState !== 'ended') {
        appendLog('[watchdog] session already terminated — syncing UI');
        setCallState('ended');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [callState]);


  // Elapsed-time ticker for the incoming-call popup's "in call" state.
  const [elapsed, setElapsed] = useState(0);
  const callStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (callState === 'in-call') {
      callStartRef.current = Date.now();
      setElapsed(0);
      const iv = setInterval(() => {
        if (callStartRef.current) setElapsed(Math.floor((Date.now() - callStartRef.current) / 1000));
      }, 1000);
      return () => clearInterval(iv);
    }
  }, [callState]);
  function formatDuration(sec: number) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  return (
    <div className="agent-extension" style={{ display: 'flex', gap: 24, padding: 24 }}>
      <style>{`
        @keyframes ring-pulse {
          0% { box-shadow: 0 0 0 0 rgba(36, 194, 116, 0.45); }
          70% { box-shadow: 0 0 0 14px rgba(36, 194, 116, 0); }
          100% { box-shadow: 0 0 0 0 rgba(36, 194, 116, 0); }
        }
        @keyframes call-popup-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <audio ref={audioRef} autoPlay />

      {/* Incoming-call popup — appears the moment a call rings in, stays
          up through Answer and the whole live call (with a running
          duration), and disappears once the call ends. Only for inbound;
          outbound status is already fully conveyed by the keypad itself
          (LCD readout + green/red action button), so no popup needed there. */}
      {callDirection === 'inbound' && (callState === 'ringing' || callState === 'in-call' || callState === 'ended') && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            width: 300,
            background: 'linear-gradient(160deg, #1c2333, #12151f)',
            borderRadius: 18,
            padding: 20,
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            color: '#eceefa',
            zIndex: 1000,
            animation: 'call-popup-in 220ms ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#262c3d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                animation: callState === 'ringing' ? 'ring-pulse 1.4s infinite' : 'none',
              }}
            >
              ☎
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#7b8399', letterSpacing: 0.5 }}>
                {callState === 'ringing' ? 'INCOMING CALL' : callState === 'in-call' ? 'IN CALL' : 'CALL ENDED'}
              </div>
              <div
                style={{
                  fontFamily: "'Roboto Mono', 'SF Mono', Consolas, monospace",
                  fontSize: 18,
                  color: '#6ffcb0',
                }}
              >
                {callerNumber}
              </div>
            </div>
          </div>

          {callState === 'ringing' && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
              <button
                onClick={hangupCall}
                aria-label="Decline"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#e5484d',
                  color: '#fff',
                  fontSize: 20,
                  cursor: 'pointer',
                  transform: 'rotate(135deg)',
                  boxShadow: '0 4px 10px rgba(229,72,77,0.4)',
                }}
              >
                ☎
              </button>
              <button
                onClick={answerCall}
                aria-label="Answer"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#24c274',
                  color: '#fff',
                  fontSize: 20,
                  cursor: 'pointer',
                  boxShadow: '0 4px 10px rgba(36,194,116,0.4)',
                }}
              >
                ☎
              </button>
            </div>
          )}

          {callState === 'in-call' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{
                  fontFamily: "'Roboto Mono', 'SF Mono', Consolas, monospace",
                  fontSize: 14,
                  color: '#7b8399',
                }}
              >
                {formatDuration(elapsed)}
              </span>
              <button
                onClick={hangupCall}
                aria-label="Hang up"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#e5484d',
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                  transform: 'rotate(135deg)',
                  boxShadow: '0 4px 10px rgba(229,72,77,0.4)',
                }}
              >
                ☎
              </button>
            </div>
          )}

          {callState === 'ended' && (
            <div style={{ fontSize: 13, color: '#7b8399' }}>Call ended</div>
          )}
        </div>
      )}

      {/* Softphone panel */}
      <div style={{ flex: '0 0 280px' }}>
        <h3>Softphone — Extension {EXT}</h3>
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            background: registerStatus.startsWith('Registered') ? '#d4edda' : '#f8d7da',
            marginBottom: 12,
          }}
        >
          {registerStatus}
        </div>

        {/* Dialpad — LCD-style readout + keypad. Digits build the dialed
            number when idle; once connected the same keys send DTMF
            instead (see pressKey). The action button below the grid is the
            single control for placing/cancelling/ending an outbound call. */}
        <div
          style={{
            background: 'linear-gradient(160deg, #1c2333, #12151f)',
            borderRadius: 20,
            padding: 16,
            marginBottom: 16,
            boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{
              background: '#08130d',
              borderRadius: 10,
              padding: '10px 12px',
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px solid #16261a',
            }}
          >
            <input
              value={callState === 'calling' || callState === 'in-call' ? callerNumber || '' : dialNumber}
              onChange={(e) => !onACall && setDialNumber(e.target.value)}
              readOnly={onACall}
              placeholder="Enter number"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !onACall && dialNumber.trim()) placeCall();
              }}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#6ffcb0',
                fontFamily: "'Roboto Mono', 'SF Mono', Consolas, monospace",
                fontSize: 20,
                letterSpacing: 2,
              }}
            />
            {!onACall && dialNumber && (
              <button
                onClick={backspace}
                aria-label="Backspace"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#4d8f6c',
                  fontSize: 18,
                  cursor: 'pointer',
                  padding: '0 4px',
                }}
              >
                ⌫
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 10, justifyContent: 'center' }}>
            {KEYPAD_ROWS.flat().map(({ digit, sub }) => (
              <KeyButton
                key={digit}
                digit={digit}
                sub={sub}
                onPress={() => pressKey(digit)}
                disabled={callState === 'ringing' || callState === 'calling' || dialing}
              />
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            {callState === 'ringing' ? (
              <div style={{ fontSize: 12, color: '#7b8399' }}>Answer/decline below ↓</div>
            ) : callState === 'calling' || callState === 'in-call' ? (
              <button
                onClick={hangupCall}
                aria-label="End call"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#e5484d',
                  color: '#fff',
                  fontSize: 22,
                  cursor: 'pointer',
                  boxShadow: '0 4px 10px rgba(229,72,77,0.4)',
                  transform: 'rotate(135deg)',
                }}
              >
                ☎
              </button>
            ) : (
              <button
                onClick={placeCall}
                disabled={dialing || !dialNumber.trim()}
                aria-label="Call"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  border: 'none',
                  background: !dialNumber.trim() ? '#2b6b48' : '#24c274',
                  color: '#fff',
                  fontSize: 22,
                  cursor: !dialNumber.trim() || dialing ? 'default' : 'pointer',
                  boxShadow: !dialNumber.trim() ? 'none' : '0 4px 10px rgba(36,194,116,0.4)',
                }}
              >
                ☎
              </button>
            )}
          </div>
        </div>

        {callState === 'ringing' && callDirection === 'inbound' && (
          <div style={{ padding: 10, background: '#fff3cd', borderRadius: 6, marginBottom: 12 }}>
            Incoming call from {callerNumber}
            <div style={{ marginTop: 8 }}>
              <button onClick={answerCall}>Answer</button>
              <button onClick={hangupCall} style={{ marginLeft: 8 }}>
                Decline
              </button>
            </div>
          </div>
        )}

        {callState === 'calling' && callDirection === 'outbound' && (
          <div style={{ padding: 10, background: '#e2e3ff', borderRadius: 6, marginBottom: 12 }}>
            Calling {callerNumber}…
          </div>
        )}


        {callState === 'in-call' && (
          <div style={{ padding: 10, background: '#cce5ff', borderRadius: 6, marginBottom: 12 }}>
            In call with {callerNumber} ({callDirection})
          </div>
        )}

        {callState === 'ended' && (
          <div style={{ padding: 10, background: '#e9ecef', borderRadius: 6, marginBottom: 12, color: '#495057' }}>
            Call ended{callerNumber ? ` — ${callerNumber}` : ''}
          </div>
        )}

        <div style={{ fontSize: 12, color: '#555', background: '#fafafa', padding: 8, borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>

      {/* Screen-pop ticket form — BR-20, BR-21 (works for either direction) */}
      <div style={{ flex: 1 }}>
        <h3>Ticket</h3>
        {!callerNumber ? (
          <p style={{ color: '#888' }}>Waiting for an inbound call, or dial out to start one…</p>
        ) : (
          <form onSubmit={submitTicket} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
            <label>
              {callDirection === 'outbound' ? 'Called number' : 'Caller number'}
              <input value={callerNumber} disabled style={{ display: 'block', width: '100%' }} />
            </label>

            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                style={{ display: 'block', width: '100%' }}
                required
              />
            </label>

            <label>
              Category
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ display: 'block', width: '100%' }}
              />
            </label>

            <label>
              Urgency
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as any)} style={{ display: 'block', width: '100%' }}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </label>

            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Ticket'}
            </button>

            {submitResult && <div>{submitResult}</div>}
          </form>
        )}
      </div>
    </div>
  );
}