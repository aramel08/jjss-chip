import React from 'react';
import PropTypes from 'prop-types';
import CopyToClipboard from 'react-copy-to-clipboard';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import JsSIP from 'jssip';
import UrlParse from 'url-parse';
import Logger from '../Logger';
import audioPlayer from '../audioPlayer';
import TransitionAppear from './TransitionAppear';
import Logo from './Logo';
import Dialer from './Dialer';
import Session from './Session';
import Incoming from './Incoming';
import { IconButton, Menu, MenuItem, } from '@material-ui/core';

// TODO: For testing.
window.jssip = JsSIP;

const callstatsjssip = window.callstatsjssip;

const logger = new Logger('Phone');

export default class Phone extends React.Component {
	constructor (props) {
		super(props);

		this.state =
		{
			// 'connecting' / disconnected' / 'connected' / 'registered'
			status: 'disconnected',
			session: null,
			incomingSession: null,
			anchorEl: null
		};

		// Mounted flag
		this._mounted = false;
		// JsSIP.UA instance
		this._ua = null;
		// Site URL
		this._u = new UrlParse(window.location.href, true);
	}

	render() {
		const state = this.state;
		const props = this.props;
		const invitationLink = `${this._u.protocol}//${this._u.host}${this._u.pathname}?callme=${props.settings.uri}`;

		return (
			<TransitionAppear duration={ 1000 }>
				<div data-component='Phone'>
					<header>
						<div className='topbar'>
							<div>
								<IconButton
									aria-label="more"
									aria-controls="long-menu"
									aria-haspopup="true"
									onClick={ this.handleClick.bind(this) }
									style={ { position: 'relative' } }
								>
									<MoreVertIcon />
									<Menu
										id="simple-menu"
										anchorEl={ state.anchorEl }
										keepMounted
										open={ Boolean(state.anchorEl) }
										onClose={ this.handleClose.bind(this) }
										style={ { position: 'absolute', bottom: 0 } }
									>
										<CopyToClipboard text={ invitationLink }
											onCopy={ this.handleMenuCopyInvitationLink.bind(this) }
										>
											<MenuItem onClick={ this.handleClose.bind(this) }>
												Copy invitation link
											</MenuItem>

										</CopyToClipboard>
										<CopyToClipboard text={ props.settings.uri || '' }
											onCopy={ this.handleMenuCopyUri.bind(this) }
										>
											<MenuItem onClick={ this.handleClose }>
												Copy my SIP URI

											</MenuItem>
										</CopyToClipboard>

										<MenuItem onClick={ this.handleMenuExit.bind(this) }>
											Exit
											</MenuItem>
									</Menu>
								</IconButton>
							</div>
							<Logo
								size='small'
							/>
						</div>

						<Dialer
							settings={ props.settings }
							status={ state.status }
							busy={ Boolean(state.session || state.incomingSession) }
							callme={ this._u.query.callme }
							onCall={ this.handleOutgoingCall.bind(this) }
						/>
					</header>

					<div className='content'>
						{ state.session && <Session
							session={ state.session }
							onNotify={ props.onNotify }
							onHideNotification={ props.onHideNotification }
						/> }


						{
							state.incomingSession && <Incoming
								session={ state.incomingSession }
								onAnswer={ this.handleAnswerIncoming.bind(this) }
								onReject={ this.handleRejectIncoming.bind(this) }
							/>
						}

					</div>
				</div>
			</TransitionAppear>
		);
	}

	componentDidMount() {
		this._mounted = true;

		const settings = this.props.settings;
		const socket = new JsSIP.WebSocketInterface(settings.socket.uri);

		if (settings.socket[ 'via_transport' ] !== 'auto')
			socket[ 'via_transport' ] = settings.socket[ 'via_transport' ];

		try {
			this._ua = new JsSIP.UA(
				{
					uri: settings.uri,
					password: settings.password,
					'display_name': settings.display_name,
					sockets: [ socket ],
					'registrar_server': settings.registrar_server,
					'contact_uri': settings.contact_uri,
					'authorization_user': settings.authorization_user,
					'instance_id': settings.instance_id,
					'session_timers': settings.session_timers,
					'use_preloaded_route': settings.use_preloaded_route
				});

			window.UA = this._ua;
		}
		catch (error) {
			this.props.onNotify(
				{
					level: 'error',
					title: 'Wrong JsSIP.UA settings',
					message: error.message
				});

			this.props.onExit();

			return;
		}

		this._ua.on('connecting', () => {
			if (!this._mounted)
				return;

			logger.debug('UA "connecting" event');

			this.setState(
				{
					uri: this._ua.configuration.uri.toString(),
					status: 'connecting'
				});
		});

		this._ua.on('connected', () => {
			if (!this._mounted)
				return;

			logger.debug('UA "connected" event');

			this.setState({ status: 'connected' });
		});

		this._ua.on('disconnected', () => {
			if (!this._mounted)
				return;

			logger.debug('UA "disconnected" event');

			this.setState({ status: 'disconnected' });
		});

		this._ua.on('registered', () => {
			if (!this._mounted)
				return;

			logger.debug('UA "registered" event');

			this.setState({ status: 'registered' });
		});

		this._ua.on('unregistered', () => {
			if (!this._mounted)
				return;

			logger.debug('UA "unregistered" event');

			if (this._ua.isConnected())
				this.setState({ status: 'connected' });
			else
				this.setState({ status: 'disconnected' });
		});

		this._ua.on('registrationFailed', (data) => {
			if (!this._mounted)
				return;

			logger.debug('UA "registrationFailed" event');

			if (this._ua.isConnected())
				this.setState({ status: 'connected' });
			else
				this.setState({ status: 'disconnected' });

			this.props.onNotify(
				{
					level: 'error',
					title: 'Registration failed',
					message: data.cause
				});
		});

		this._ua.on('newRTCSession', (data) => {
			if (!this._mounted)
				return;

			// TODO: For testing.
			window.SESSION = data.session;

			if (data.originator === 'local')
				return;

			logger.debug('UA "newRTCSession" event');

			const state = this.state;
			const session = data.session;

			// Avoid if busy or other incoming
			if (state.session || state.incomingSession) {
				logger.debug('incoming call replied with 486 "Busy Here"');

				session.terminate(
					{
						'status_code': 486,
						'reason_phrase': 'Busy Here'
					});

				return;
			}

			audioPlayer.play('ringing');
			this.setState({ incomingSession: session });

			session.on('failed', () => {
				audioPlayer.stop('ringing');
				this.setState(
					{
						session: null,
						incomingSession: null
					});
			});

			session.on('ended', () => {
				this.setState(
					{
						session: null,
						incomingSession: null
					});
			});

			session.on('accepted', () => {
				audioPlayer.stop('ringing');
				this.setState(
					{
						session: session,
						incomingSession: null
					});
			});
		});

		this._ua.start();

		// Set callstats stuff
		if (settings.callstats.enabled) {
			callstatsjssip(
				// JsSIP.UA instance
				this._ua,
				// AppID
				settings.callstats.AppID,
				// AppSecret
				// 'zAWooDtrYJPo:OeNNdLBBk7nOq9mCS5qbxOhuzt6IdCvnx3cjNGj2tBo='
				settings.callstats.AppSecret
			);
		}
	}

	componentWillUnmount() {
		this._mounted = false;
	}

	handleMenuCopyInvitationLink() {
		logger.debug('handleMenuCopyInvitationLink()');

		const message = 'Invitation link copied to the clipboard';

		this.props.onShowSnackbar(message, 3000);
	}
	handleClick(event) {

		this.setState({
			anchorEl: !this.state.anchorEl
		})

	};

	handleClose = () => {
		this.setState({
			anchorEl: null
		})

	};
	handleMenuCopyUri() {
		logger.debug('handleMenuCopyUri()');

		const message = 'Your SIP URI copied to the clipboard';

		this.props.onShowSnackbar(message, 3000);
	}

	handleMenuExit() {
		logger.debug('handleMenuExit()');
		this.handleClose();
		this._ua.stop();
		this.props.onExit();
	}

	handleOutgoingCall(uri) {
		logger.debug('handleOutgoingCall() [uri:"%s"]', uri);

		const session = this._ua.call(uri,
			{
				pcConfig: this.props.settings.pcConfig || { iceServers: [] },
				mediaConstraints:
				{
					audio: true,
					video: true
				},
				rtcOfferConstraints:
				{
					offerToReceiveAudio: 1,
					offerToReceiveVideo: 1
				}
			})
		session.on('connecting', () => {

			this.setState({ session });
		});

		session.on('progress', () => {
			audioPlayer.play('ringback');
		});

		session.on('failed', (data) => {
			audioPlayer.stop('ringback');
			audioPlayer.play('rejected');
			this.setState({ session: null });

			this.props.onNotify(
				{
					level: 'error',
					title: 'Call failed',
					message: data.cause
				});
		});

		session.on('ended', () => {
			audioPlayer.stop('ringback');
			this.setState({ session: null });
		});

		session.on('accepted', () => {
			audioPlayer.stop('ringback');
			audioPlayer.play('answered');
		});
	}

	handleAnswerIncoming() {
		logger.debug('handleAnswerIncoming()');

		const session = this.state.incomingSession;

		session.answer(
			{
				pcConfig: this.props.settings.pcConfig || { iceServers: [] }
			});
	}

	handleRejectIncoming() {
		logger.debug('handleRejectIncoming()');

		const session = this.state.incomingSession;

		session.terminate();
	}
}

Phone.propTypes =
{
	settings: PropTypes.object.isRequired,
	onNotify: PropTypes.func.isRequired,
	onHideNotification: PropTypes.func.isRequired,
	onShowSnackbar: PropTypes.func.isRequired,
	onHideSnackbar: PropTypes.func.isRequired,
	onExit: PropTypes.func.isRequired
};
